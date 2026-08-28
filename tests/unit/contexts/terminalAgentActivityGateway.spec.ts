import { createServer, request, type Server } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { TerminalAgentActivityGateway } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { TerminalAgentActivityEnvironmentService } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'

function post(
  endpoint: string,
  token: string,
  payload: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const outgoing = request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-opencove-terminal-agent-token': token,
      },
    })
    outgoing.once('error', reject)
    outgoing.once('response', response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.once('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: response.statusCode ?? 0,
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
        })
      })
    })
    outgoing.end(body)
  })
}

describe('TerminalAgentActivityGateway', () => {
  it('starts one owned server for concurrent first reservations and disposes every credential', async () => {
    const servers: Server[] = []
    const createHttpServer = vi.fn(((listener: Parameters<typeof createServer>[0]) => {
      const server = createServer(listener)
      servers.push(server)
      return server
    }) as typeof createServer)
    const gateway = new TerminalAgentActivityGateway({
      resolveHookInjection: () => null,
      createHttpServer,
    })

    try {
      const reservations = await Promise.all(
        Array.from({ length: 8 }, async () => await gateway.reserveTerminal()),
      )
      expect(createHttpServer).toHaveBeenCalledTimes(1)
      expect(new Set(reservations.map(reservation => reservation.endpoint)).size).toBe(1)
      await Promise.all(reservations.map(async reservation => await reservation.dispose()))
      await gateway.dispose()
      expect(servers).toHaveLength(1)
      expect(servers.every(server => !server.listening)).toBe(true)
    } finally {
      await Promise.all(
        servers.map(
          async server =>
            await new Promise<void>(resolve => {
              if (!server.listening) {
                resolve()
                return
              }
              server.close(() => resolve())
              server.closeAllConnections()
            }),
        ),
      )
    }
  })

  it('disposes a delayed planner scope when its credential dies during planning', async () => {
    let releasePlanning!: () => void
    const planningReleased = new Promise<void>(resolve => {
      releasePlanning = resolve
    })
    let planningStarted!: () => void
    const planningDidStart = new Promise<void>(resolve => {
      planningStarted = resolve
    })
    const disposeArtifact = vi.fn(async () => undefined)
    const onStarted = vi.fn()
    const gateway = new TerminalAgentActivityGateway({
      resolveHookInjection: () => ({
        prepareHookInjection: async command => {
          command.artifacts.track('delayed-artifact', { dispose: disposeArtifact })
          planningStarted()
          await planningReleased
          return {
            args: ['--delayed'],
            env: {},
            hookInstallState: 'installed',
            onStarted,
          }
        },
      }),
    })
    const metadata: unknown[] = []
    gateway.onMetadata(event => metadata.push(event))
    const terminal = await gateway.reserveTerminal()
    terminal.commit('pty-disposed-during-planning')

    const preparing = post(terminal.endpoint, terminal.token, {
      operation: 'prepare',
      provider: 'claude-code',
      invocationId: 'invocation-delayed',
      cwd: '/tmp/workspace',
      executablePath: '/real/claude',
      environment: { PATH: '/real/bin' },
    })
    await planningDidStart
    await terminal.dispose()
    releasePlanning()

    await expect(preparing).resolves.toMatchObject({ status: 410 })
    expect(disposeArtifact).toHaveBeenCalledTimes(1)
    expect(onStarted).not.toHaveBeenCalled()
    expect(metadata).toEqual([])
    await gateway.dispose()
  })

  it('fails open to the original shell when private asset preparation fails', async () => {
    const reserveTerminal = vi.fn()
    const service = new TerminalAgentActivityEnvironmentService({
      assets: { ensure: async () => await Promise.reject(new Error('asset failure')) } as never,
      gateway: { reserveTerminal } as never,
      inheritedPath: '/inherited/bin',
      inheritedShell: '/bin/bash',
      platform: 'linux',
    })

    const prepared = await service.prepare({
      args: ['-l'],
      command: '/bin/bash',
      cwd: '/tmp/workspace',
      environment: { PATH: '/user/bin', USER_SENTINEL: 'preserved' },
      interactiveShell: true,
    })

    expect(prepared).toMatchObject({
      args: ['-l'],
      command: '/bin/bash',
      environment: { PATH: '/user/bin', USER_SENTINEL: 'preserved' },
    })
    expect(reserveTerminal).not.toHaveBeenCalled()
    await expect(prepared.dispose()).resolves.toBeUndefined()

    const inherited = await service.prepare({
      args: [],
      command: '/bin/bash',
      cwd: '/tmp/workspace',
      environment: undefined,
      interactiveShell: true,
    })
    expect(inherited.environment).toBeUndefined()
  })

  it('leaves WSL profiles exactly unchanged and allocates no host shim credential', async () => {
    const ensure = vi.fn()
    const reserveTerminal = vi.fn()
    const service = new TerminalAgentActivityEnvironmentService({
      assets: { ensure } as never,
      gateway: { reserveTerminal } as never,
      inheritedPath: 'C:\\Windows\\System32',
      inheritedShell: 'powershell.exe',
      platform: 'win32',
    })
    const command = {
      args: ['-d', 'Ubuntu', '--', 'bash', '-l'],
      command: 'C:\\Windows\\System32\\wsl.exe',
      cwd: 'C:\\workspace',
      environment: { Path: 'C:\\Windows\\System32', USER_SENTINEL: 'preserved' },
      interactiveShell: true,
      runtimeKind: 'wsl' as const,
    }

    const prepared = await service.prepare(command)

    expect(prepared).toMatchObject({
      args: command.args,
      command: command.command,
      environment: command.environment,
    })
    expect(ensure).not.toHaveBeenCalled()
    expect(reserveTerminal).not.toHaveBeenCalled()
    await expect(prepared.dispose()).resolves.toBeUndefined()
  })

  it('queues pre-commit activity, advances generations, and rejects stale completion', async () => {
    const disposed: string[] = []
    const started: Array<{
      sessionId: string
      context: { isCurrent: () => boolean; generation: number }
    }> = []
    const gateway = new TerminalAgentActivityGateway({
      resolveHookInjection: provider => ({
        prepareHookInjection: async command => {
          command.artifacts.track(`${provider}-artifact`, {
            dispose: async () => {
              disposed.push(provider)
            },
          })
          return {
            args: [`--hook-for=${provider}`],
            env: { PROVIDER_HOOK: provider },
            hookInstallState: 'installed',
            onStarted: (sessionId, context) => {
              if (context) {
                started.push({ sessionId, context })
              }
            },
          }
        },
      }),
    })
    await gateway.start()
    const metadata: unknown[] = []
    gateway.onMetadata(event => metadata.push(event))
    const terminal = await gateway.reserveTerminal()

    const first = await post(terminal.endpoint, terminal.token, {
      operation: 'prepare',
      provider: 'claude-code',
      invocationId: 'invocation-1',
      cwd: '/tmp/workspace',
      executablePath: '/real/claude',
      environment: { PATH: '/real/bin' },
    })
    expect(first).toEqual({
      status: 200,
      body: {
        ok: true,
        args: ['--hook-for=claude-code'],
        env: { PROVIDER_HOOK: 'claude-code' },
        generation: 1,
      },
    })
    expect(metadata).toEqual([])

    terminal.commit('pty-1')
    expect(metadata).toEqual([
      {
        sessionId: 'pty-1',
        resumeSessionId: null,
        terminalAgentActivity: expect.objectContaining({
          provider: 'claude-code',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'active',
          identityAuthority: null,
        }),
      },
    ])
    expect(started[0]?.sessionId).toBe('pty-1')
    expect(started[0]?.context.isCurrent()).toBe(true)

    const second = await post(terminal.endpoint, terminal.token, {
      operation: 'prepare',
      provider: 'codex',
      invocationId: 'invocation-2',
      cwd: '/tmp/workspace',
      executablePath: '/real/codex',
      environment: { PATH: '/real/bin' },
    })
    expect(second.body).toMatchObject({ ok: true, generation: 2 })
    expect(started[0]?.context.isCurrent()).toBe(false)
    expect(started[1]?.context.isCurrent()).toBe(true)

    await expect(
      post(terminal.endpoint, terminal.token, {
        operation: 'complete',
        invocationId: 'invocation-1',
        generation: 1,
      }),
    ).resolves.toMatchObject({ status: 204 })
    expect(metadata).toHaveLength(2)
    expect(disposed).toEqual(['claude-code'])

    await expect(
      post(terminal.endpoint, terminal.token, {
        operation: 'complete',
        invocationId: 'invocation-2',
        generation: 2,
      }),
    ).resolves.toMatchObject({ status: 204 })
    expect(metadata).toHaveLength(3)
    expect(metadata[2]).toMatchObject({
      sessionId: 'pty-1',
      terminalAgentActivity: { generation: 2, phase: 'exited' },
    })
    expect(started[1]?.context.isCurrent()).toBe(false)
    expect(disposed).toEqual(['claude-code', 'codex'])

    await terminal.dispose()
    await gateway.dispose()
  })

  it('rejects a forged terminal token', async () => {
    const gateway = new TerminalAgentActivityGateway({
      resolveHookInjection: () => null,
    })
    await gateway.start()
    const terminal = await gateway.reserveTerminal()
    await expect(
      post(terminal.endpoint, 'forged', {
        operation: 'prepare',
        provider: 'claude-code',
        invocationId: 'invocation-1',
        cwd: '/tmp',
        executablePath: '/real/claude',
        environment: { PATH: '/real/bin' },
      }),
    ).resolves.toMatchObject({ status: 401 })
    await terminal.dispose()
    await gateway.dispose()
  })
})
