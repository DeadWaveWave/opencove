import type { CreateAgentLaunchPlanCommand } from '../../../src/contexts/agent/application/ports/AgentProviderContribution'
import { checkProductionGrantPolicy } from './sessionGrantPolicy.productionChecks'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises'
import { join, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import type { ControlSurfaceHttpListener } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime.contract'
import type { createControlSurfaceHttpListener } from '../../../src/app/main/controlSurface/controlSurfaceHttpListener'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

// Only replace the listening socket. Production runtime, handlers, registry, auth and assets remain real.
const captured = vi.hoisted(() => ({
  listeners: [] as Parameters<typeof createControlSurfaceHttpListener>[0][],
}))
vi.mock('../../../src/app/main/controlSurface/controlSurfaceHttpListener', () => ({
  createControlSurfaceHttpListener: (
    input: Parameters<typeof createControlSurfaceHttpListener>[0],
  ) => {
    captured.listeners.push(input)
    return {
      ready: Promise.resolve({ hostname: '127.0.0.1', bindHostname: '127.0.0.1', port: 12345 }),
      stopAccepting: async () => {},
      closeStreamingClients: () => {},
      dispose: () => {},
    } as unknown as ControlSurfaceHttpListener
  },
}))
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'

it('production Worker issues canvas credentials, exposes shim and whoami, and revokes on kill/exit/shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opencove-grant-production-'))
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(createMinimalState(dir, 'project', 'space'))
  const exits = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const spawn = vi.fn(async (_input: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0]) => ({
    sessionId: `session-${spawn.mock.calls.length}`,
  }))
  const approvedWorkspaces = createApprovedWorkspaceStoreForPath(join(dir, 'approved.json'))
  await approvedWorkspaces.registerRoot(dir)
  const write = vi.fn()
  const kill = vi.fn((sessionId: string) => {
    exits.forEach(emit => emit({ sessionId, exitCode: 0 }))
  })
  const createLaunchPlan = vi.fn(async (_command: CreateAgentLaunchPlanCommand) => ({
    command: '/bin/sh',
    args: [],
    env: {},
    effectiveModel: null,
    launchMode: 'new' as const,
    resumeSessionId: null,
  }))
  let surface!: ControlSurface
  const runtime = createControlSurfaceHttpRuntime({
    agentProviderRegistry: new AgentProviderRegistry([
      {
        descriptor: {
          id: 'codex',
          displayName: 'fixture',
          documentationUrl: '',
          launch: { executable: '/bin/sh', defaultArguments: [], defaultEnvironment: {} },
        },
        detector: { inspect: vi.fn() },
        launcher: {
          createLaunchPlan,
        },
      },
    ]),
    userDataPath: dir,
    token: 'worker-secret',
    createPersistenceStore: async () => store,
    approvedWorkspaces,
    ptyRuntime: {
      spawnSession: spawn,
      write,
      resize: async () => ({ status: 'session_not_found' }) as never,
      kill,
      onData: () => () => {},
      onExit: listener => {
        exits.add(listener)
        return () => {
          exits.delete(listener)
        }
      },
    },
  })
  try {
    runtime.registerHandlers(control => {
      surface = control
    })
    await runtime.ready
    await runtime.listen({
      role: 'private',
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 12345,
      enableWebShell: false,
      webUiPasswordHash: null,
    }).ready
    const listener = captured.listeners.at(-1)!
    const responses: string[] = []
    const invoke = async (
      id: string,
      payload: unknown,
      token = 'worker-secret',
      kind = 'command',
    ) => {
      const req = Object.assign(new EventEmitter(), {
        method: 'POST',
        url: '/invoke',
        headers: { authorization: `Bearer ${token}` },
      }) as IncomingMessage
      let body = ''
      const res = Object.assign(new EventEmitter(), {
        statusCode: 0,
        setHeader: () => {},
        end: (value: string) => {
          body = value
        },
      }) as unknown as ServerResponse
      const pending = listener.handleRequest({
        req,
        res,
        listenerSyncClients: new Set(),
        listener: {
          ...listener.config,
          webUiAuthRevision: 0,
          isWebUiAuthRevisionCurrent: () => true,
        },
      })
      await vi.waitFor(() => expect(req.listenerCount('end')).toBe(1), { interval: 1 })
      req.emit('data', JSON.stringify({ kind, id, payload }))
      req.emit('end')
      await pending
      responses.push(body)
      return { status: res.statusCode, result: JSON.parse(body) }
    }
    const launched = await invoke('pty.spawn', {
      cwd: dir,
      workspaceId: 'project',
      spaceId: 'space',
      canvasNodeId: 'node',
      command: '/bin/sh',
      args: [],
      cols: 80,
      rows: 24,
    })
    expect(launched.result).toMatchObject({ ok: true })
    const env = spawn.mock.calls[0][0].env!
    const published = createMinimalState(dir, 'project', 'space')
    published.workspaces[0].nodes = [
      { id: 'node', kind: 'terminal', title: 'Caller', sessionId: launched.result.value.sessionId },
    ]
    published.workspaces[0].spaces[0].nodeIds = ['node']
    expect(await store.writeAppState(published)).toMatchObject({ ok: true })
    expect(env).toMatchObject({
      OPENCOVE_ENV: '1',
      OPENCOVE_NODE_ID: 'node',
      OPENCOVE_PROJECT_ID: 'project',
      OPENCOVE_SPACE_ID: 'space',
      OPENCOVE_CONTROL_URL: 'http://127.0.0.1:12345',
    })
    const token = env.OPENCOVE_CONTROL_TOKEN!
    expect(token).not.toBe('worker-secret')
    expect(JSON.stringify(launched)).not.toContain(token)
    const bin = env.PATH!.split(delimiter)[0]
    expect(await readFile(join(bin, 'opencove'), 'utf8')).toContain('"$OPENCOVE_CLI" "$@"')
    expect(await readFile(join(bin, 'opencove.cmd'), 'utf8')).toContain('"%OPENCOVE_CLI%" %*')
    if (process.platform !== 'win32') {
      const cliFixture = join(dir, 'cli fixture.mjs')
      await writeFile(
        cliFixture,
        'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), hasCredential: !!process.env.OPENCOVE_CONTROL_TOKEN }))',
      )
      const output = await promisify(execFile)(join(bin, 'opencove'), ['argument with spaces'], {
        env: { ...env, OPENCOVE_CLI: cliFixture },
      })
      expect(JSON.parse(output.stdout)).toEqual({
        args: ['argument with spaces'],
        hasCredential: true,
      })
    }
    expect((await invoke('system.whoami', {}, token, 'query')).result).toMatchObject({
      ok: true,
      value: { kind: 'session-grant', nodeId: 'node', sessionId: launched.result.value.sessionId },
    })
    await checkProductionGrantPolicy({
      invoke,
      token,
      surface,
      store,
      spawnCount: () => spawn.mock.calls.length,
      writeCount: () => write.mock.calls.length,
      killCount: () => kill.mock.calls.length,
    })
    expect(createLaunchPlan).toHaveBeenCalledWith(
      expect.objectContaining({ agentFullAccess: false }),
    )
    const mount = await invoke('mount.create', {
      projectId: 'project',
      endpointId: 'local',
      rootPath: dir,
    })
    expect(mount.result.error).toBeUndefined()
    const forwarded = await invoke(
      'session.launchAgent',
      { spaceId: 'space', prompt: 'mounted review' },
      token,
    )
    expect(forwarded.result).toMatchObject({ ok: true })
    await invoke('session.kill', { sessionId: forwarded.result.value.sessionId }, token)
    await checkProductionGrantPolicy({
      invoke,
      token,
      surface,
      store,
      spawnCount: () => spawn.mock.calls.length,
      writeCount: () => write.mock.calls.length,
      killCount: () => kill.mock.calls.length,
    })
    await invoke('session.kill', { sessionId: launched.result.value.sessionId })
    // Invalid auth returns before reading a body, so invoke directly with a completed fixture below.
    const unauthorized = async (credential = token) => {
      const req = {
        method: 'POST',
        url: '/invoke',
        headers: { authorization: `Bearer ${credential}` },
      } as IncomingMessage
      let status = 0
      const res = {
        set statusCode(value: number) {
          status = value
        },
        setHeader() {},
        end() {},
      } as unknown as ServerResponse
      await listener.handleRequest({
        req,
        res,
        listenerSyncClients: new Set(),
        listener: {
          ...listener.config,
          webUiAuthRevision: 0,
          isWebUiAuthRevisionCurrent: () => true,
        },
      })
      return status
    }
    expect(await unauthorized()).toBe(401)
    const second = await invoke('pty.spawn', {
      cwd: dir,
      workspaceId: 'project',
      spaceId: 'space',
      canvasNodeId: 'node2',
      command: '/bin/sh',
      cols: 80,
      rows: 24,
    })
    expect(second.result.ok).toBe(true)
    exits.forEach(emit => emit({ sessionId: second.result.value.sessionId, exitCode: 0 }))
    const secondToken = spawn.mock.calls.at(-1)![0].env!.OPENCOVE_CONTROL_TOKEN!
    expect(await unauthorized(secondToken)).toBe(401)
    const mounted = await invoke('pty.spawnInMount', {
      mountId: mount.result.value.mount.mountId,
      workspaceId: 'project',
      spaceId: 'space',
      canvasNodeId: 'mounted',
      command: '/bin/sh',
    })
    expect(mounted.result).toMatchObject({ ok: true })
    expect(spawn.mock.calls.at(-1)![0].env!.OPENCOVE_NODE_ID).toBe('mounted')
    const created = await invoke('node.create', {
      kind: 'terminal',
      space: { kind: 'spaceId', spaceId: 'space' },
      data: {},
    })
    expect(created.result.error).toBeUndefined()
    const createdEnv = spawn.mock.calls.at(-1)![0].env!
    expect(createdEnv.OPENCOVE_NODE_ID).toBe(created.result.value.node.id)
    const createdSession = (
      await invoke('system.whoami', {}, createdEnv.OPENCOVE_CONTROL_TOKEN!, 'query')
    ).result.value.sessionId
    await invoke('session.kill', { sessionId: createdSession })
    const recovered = await invoke('session.prepareOrRevive', {
      workspaceId: 'project',
      nodeIds: [created.result.value.node.id],
    })
    expect(recovered.result.error).toBeUndefined()
    const recoveredEnv = spawn.mock.calls.at(-1)![0].env!
    expect(recoveredEnv.OPENCOVE_NODE_ID).toBe(createdEnv.OPENCOVE_NODE_ID)
    expect(recoveredEnv.OPENCOVE_CONTROL_TOKEN !== createdEnv.OPENCOVE_CONTROL_TOKEN).toBe(true)
    expect(await unauthorized(createdEnv.OPENCOVE_CONTROL_TOKEN)).toBe(401)
    const denied = await invoke(
      'pty.spawn',
      { cwd: dir, canvasNodeId: 'spoof', workspaceId: 'project' },
      recoveredEnv.OPENCOVE_CONTROL_TOKEN!,
    )
    expect(denied.result).toMatchObject({ ok: false, error: { code: 'common.forbidden' } })
    const agent = await invoke('session.launchAgent', {
      cwd: dir,
      workspaceId: 'project',
      spaceId: 'space',
      canvasNodeId: 'agent',
      prompt: '',
      provider: 'codex',
    })
    expect(agent.result.error).toBeUndefined()
    const agentEnv = spawn.mock.calls.at(-1)![0].env!
    expect(
      (await invoke('system.whoami', {}, agentEnv.OPENCOVE_CONTROL_TOKEN!, 'query')).result.value
        .nodeId,
    ).toBe('agent')
    const mountedAgent = await invoke('session.launchAgentInMount', {
      mountId: mount.result.value.mount.mountId,
      workspaceId: 'project',
      spaceId: 'space',
      canvasNodeId: 'mounted-agent',
      prompt: '',
      provider: 'codex',
    })
    expect(mountedAgent.result.error).toBeUndefined()
    expect(spawn.mock.calls.at(-1)![0].env!.OPENCOVE_NODE_ID).toBe('mounted-agent')
    const logPaths = await readdir(join(dir, 'logs')).catch(() => [] as string[])
    const logs = await Promise.all(logPaths.map(path => readFile(join(dir, 'logs', path), 'utf8')))
    for (const [call] of spawn.mock.calls) {
      const credential = call.env!.OPENCOVE_CONTROL_TOKEN!
      expect([...logs, ...responses].some(value => value.includes(credential))).toBe(false)
    }
    runtime.beginShutdown()
    // Shutdown closes all ingress (503), and dispose retires the registry as well.
  } finally {
    await runtime.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
