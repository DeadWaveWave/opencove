// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LaunchAgentSessionResult } from '../../../src/shared/contracts/dto'
import { createLaunchWorker, cwd, rootUri, savedKey } from './sessionGrantLaunchSecurity.testUtils'
import { createAppError } from '../../../src/shared/errors/appError'

const seam = vi.hoisted(() => ({ platform: 'linux' as NodeJS.Platform, remote: vi.fn() }))
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: seam.remote,
}))
vi.mock('../../../src/app/main/controlSurface/handlers/sessionAgentTestStub', () => ({
  resolveWorkerAgentTestStub: () => null,
}))
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async (env: NodeJS.ProcessEnv = {}) => env,
}))
// Only inject platform/OS discovery. Both launch resolver and actual profile resolution run.
vi.mock('../../../src/platform/terminal/TerminalProfileResolver', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/platform/terminal/TerminalProfileResolver')>()
  return {
    ...actual,
    TerminalProfileResolver: class extends actual.TerminalProfileResolver {
      override async resolveCommandSpawn(
        input: Parameters<
          InstanceType<typeof actual.TerminalProfileResolver>['resolveCommandSpawn']
        >[0],
      ) {
        return new actual.TerminalProfileResolver({
          platform: seam.platform,
          env: () => ({ PATH: '/fixture/bin' }),
          homeDir: () => 'C:\\Users\\fixture',
          processCwd: () => 'C:\\repo',
          locateWindowsCommands: async commands =>
            commands[0] === 'bash.exe' ? ['C:\\Git\\bin\\bash.exe'] : [],
          listWslDistros: async () => ['Ubuntu'],
        }).resolveCommandSpawn(input)
      }
    },
  }
})
beforeEach(() => {
  seam.platform = 'linux'
})
afterEach(() => {
  vi.clearAllMocks()
})
const serializedKey = JSON.stringify(savedKey).slice(1, -1)

const launchRequest = (route: 'direct' | 'mount', extra: object = {}) => ({
  kind: 'command' as const,
  id: route === 'direct' ? 'session.launchAgent' : 'session.launchAgentInMount',
  payload: {
    ...(route === 'direct' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
    prompt: 'Explain this project',
    ...extra,
  },
})

it.each([false, true])(
  'forwards Home permission policy=%s into an independently configured Worker',
  async homeSetting => {
    const home = await createLaunchWorker({
      name: 'home',
      fullAccess: homeSetting,
      reuse: homeSetting,
      remote: true,
    })
    const worker = await createLaunchWorker({
      name: 'worker',
      fullAccess: !homeSetting,
      reuse: !homeSetting,
      savedKey: 'different-worker-private-key',
    })
    seam.remote.mockImplementation(async (_endpoint, request) => ({
      result:
        request.id === 'workspace.approveRoot'
          ? { ok: true, value: null }
          : await worker.invoke('bearer', request),
    }))
    expect(
      await home.invoke(
        'bearer',
        launchRequest('mount', {
          agentFullAccess: homeSetting,
          codexReuseRunningAppServer: homeSetting,
          env: { S1A_TEST_API_KEY: savedKey },
        }),
      ),
    ).toMatchObject({ ok: true })
    expect(worker.plan.mock.calls[0][0]).toMatchObject({
      agentFullAccess: homeSetting,
      codexReuseRunningAppServer: homeSetting,
    })
    expect(worker.spawn).toHaveBeenCalledOnce()
    expect(worker.plan.mock.calls[0][0].environment?.S1A_TEST_API_KEY).toBe(savedKey)
    expect(worker.spawn.mock.calls[0][0].env?.S1A_TEST_API_KEY).toBe(savedKey)
    expect(home.spawn).not.toHaveBeenCalled()
  },
)

it.each(['bearer', 'cookie'] as const)(
  'keeps %s remote permission defaults and explicit overrides',
  async caller => {
    const home = await createLaunchWorker({
      name: 'home',
      fullAccess: false,
      reuse: false,
      remote: true,
    })
    const worker = await createLaunchWorker({ name: 'worker', fullAccess: true, reuse: true })
    seam.remote.mockImplementation(async (_endpoint, request) => ({
      result:
        request.id === 'workspace.approveRoot'
          ? { ok: true, value: null }
          : await worker.invoke('bearer', request),
    }))
    expect(await home.invoke(caller, launchRequest('mount'))).toMatchObject({ ok: true })
    expect(
      await home.invoke(
        caller,
        launchRequest('mount', {
          agentFullAccess: false,
          codexReuseRunningAppServer: false,
        }),
      ),
    ).toMatchObject({ ok: true })
    expect(
      worker.plan.mock.calls.map(([input]) => [
        input.agentFullAccess,
        input.codexReuseRunningAppServer,
      ]),
    ).toEqual([
      [true, true],
      [false, false],
    ])
  },
)

for (const route of ['direct', 'mount'] as const) {
  for (const profile of [
    'posix',
    'wsl:Ubuntu',
    'powershell',
    'bash:c:\\git\\bin\\bash.exe',
    'default-windows',
  ] as const) {
    it.each(['grant', 'bearer', 'cookie'] as const)(
      `keeps ${route}/${profile} environment private for %s`,
      async caller => {
        seam.platform = profile === 'posix' ? 'linux' : 'win32'
        const f = await createLaunchWorker({
          name: 'worker',
          fullAccess: false,
          reuse: false,
          profileId: profile,
        })
        const result = await f.invoke(
          caller,
          launchRequest(route, caller === 'grant' ? {} : { env: { S1A_TEST_API_KEY: savedKey } }),
        )
        expect(result).toMatchObject({ ok: true })
        expect(f.plan.mock.calls[0][0].environment?.S1A_TEST_API_KEY).toBe(savedKey)
        const spawn = f.spawn.mock.calls[0][0]
        expect(spawn.env?.S1A_TEST_API_KEY).toBe(savedKey)
        if (profile === 'wsl:Ubuntu') {
          expect(spawn.command).toBe('wsl.exe')
          expect(spawn.args).toContain(`S1A_TEST_API_KEY=${savedKey}`)
        }
        const value = (result as { ok: true; value: LaunchAgentSessionResult }).value
        const get = await f.invoke('grant', {
          kind: 'query',
          id: 'session.get',
          payload: { sessionId: value.sessionId },
        })
        const list = await f.invoke('grant', { kind: 'query', id: 'session.list', payload: null })
        const state = (await f.store.readAppState()) as {
          workspaces: { nodes: object[]; spaces: { nodeIds: string[] }[] }[]
        }
        state.workspaces[0].nodes.push({
          id: 'launched-node',
          kind: 'terminal',
          sessionId: value.sessionId,
          position: { x: 0, y: 0 },
          size: { width: 480, height: 360 },
          title: 'Agent',
          status: 'running',
        })
        state.workspaces[0].spaces[0].nodeIds.push('launched-node')
        await f.store.writeAppState(state)
        const nodeGet = await f.invoke('grant', {
          kind: 'query',
          id: 'session.get',
          payload: { nodeId: 'launched-node' },
        })
        expect(get).toMatchObject({ ok: true, value: { sessionId: value.sessionId } })
        expect(list).toMatchObject({
          ok: true,
          value: { sessions: [{ sessionId: value.sessionId }] },
        })
        expect(nodeGet).toMatchObject({ ok: true, value: { sessionId: value.sessionId } })
        for (const envelope of [
          result,
          get,
          nodeGet,
          list,
          f.hub.getSessionMetadata(value.sessionId),
        ]) {
          expect(JSON.stringify(envelope)).not.toContain(serializedKey)
          expect(JSON.stringify(envelope)).not.toContain('S1A_TEST_API_KEY=')
        }
        if (profile === 'posix') {
          expect(value).toMatchObject({
            command: 'fixture-agent',
            args: ['--model', 'fixture-model'],
          })
        }
      },
    )
  }
}

it.each(['pty.spawn', 'pty.spawnInMount'] as const)(
  'keeps WSL explicit environment out of %s metadata',
  async id => {
    seam.platform = 'win32'
    const f = await createLaunchWorker({ name: 'worker', fullAccess: false, reuse: false })
    const result = await f.invoke('bearer', {
      kind: 'command',
      id,
      payload: {
        ...(id === 'pty.spawn' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
        command: 'fixture-agent',
        args: ['--model', 'fixture-model'],
        profileId: 'wsl:Ubuntu',
        env: { S1A_TEST_API_KEY: savedKey },
        cols: 80,
        rows: 24,
      },
    })
    expect(result).toMatchObject({ ok: true })
    expect(f.spawn.mock.calls[0][0].args).toContain(`S1A_TEST_API_KEY=${savedKey}`)
    expect(JSON.stringify(result)).not.toContain(serializedKey)
    expect(JSON.stringify(f.hub.listSessions())).not.toContain(serializedKey)
  },
)

it('keeps a real remote WSL launch private through Home get/list', async () => {
  seam.platform = 'win32'
  const home = await createLaunchWorker({
    name: 'home',
    fullAccess: false,
    reuse: false,
    remote: true,
  })
  const worker = await createLaunchWorker({
    name: 'worker',
    fullAccess: true,
    reuse: true,
    profileId: 'wsl:Ubuntu',
  })
  seam.remote.mockImplementation(async (_endpoint, request) => ({
    result:
      request.id === 'workspace.approveRoot'
        ? { ok: true, value: null }
        : await worker.invoke('bearer', request),
  }))
  const result = await home.invoke(
    'bearer',
    launchRequest('mount', { env: { S1A_TEST_API_KEY: savedKey } }),
  )
  expect(result).toMatchObject({ ok: true })
  const value = (result as { ok: true; value: LaunchAgentSessionResult }).value
  expect(worker.spawn.mock.calls[0][0].args).toContain(`S1A_TEST_API_KEY=${savedKey}`)
  const get = await home.invoke('grant', {
    kind: 'query',
    id: 'session.get',
    payload: { sessionId: value.sessionId },
  })
  const list = await home.invoke('grant', { kind: 'query', id: 'session.list', payload: null })
  expect(get.ok).toBe(true)
  expect(list.ok).toBe(true)
  expect(JSON.stringify([result, get, list])).not.toContain(serializedKey)
})

it('protects Home metadata from an older WSL Worker response', async () => {
  const home = await createLaunchWorker({
    name: 'home',
    fullAccess: false,
    reuse: false,
    remote: true,
  })
  seam.remote.mockImplementation(async (_endpoint, request) => ({
    result: {
      ok: true,
      value:
        request.id === 'workspace.approveRoot'
          ? null
          : {
              sessionId: 'legacy-child',
              provider: 'codex',
              startedAt: new Date().toISOString(),
              executionContext: { workingDirectory: cwd },
              profileId: 'wsl:Ubuntu',
              runtimeKind: 'wsl',
              effectiveModel: null,
              resumeSessionId: null,
              command: 'C:\\Windows\\System32\\wsl.exe',
              args: [
                '--distribution',
                'Ubuntu',
                'env',
                `S1A_TEST_API_KEY=${savedKey}`,
                'fixture-agent',
              ],
            },
    },
  }))
  const result = await home.invoke(
    'bearer',
    launchRequest('mount', { env: { S1A_TEST_API_KEY: savedKey } }),
  )
  expect(result).toMatchObject({ ok: true })
  const value = (result as { ok: true; value: LaunchAgentSessionResult }).value
  const get = await home.invoke('grant', {
    kind: 'query',
    id: 'session.get',
    payload: { sessionId: value.sessionId },
  })
  expect(JSON.stringify([result, get, home.hub.listSessions()])).not.toContain(serializedKey)
  // Recovery imports old Worker listing metadata through this same hub boundary.
  home.hub.registerSessionMetadata({
    sessionId: 'recovered',
    kind: 'agent',
    startedAt: '',
    cwd,
    command: 'wsl.exe',
    args: ['env', `S1A_TEST_API_KEY=${savedKey}`, 'fixture-agent'],
    cols: 80,
    rows: 24,
  })
  expect(JSON.stringify(home.hub.listSessions())).not.toContain(serializedKey)
})

it.each(['direct', 'mount'] as const)(
  'keeps private %s spawn arguments out of failure envelopes',
  async route => {
    seam.platform = 'win32'
    const f = await createLaunchWorker({
      name: 'worker',
      fullAccess: false,
      reuse: false,
      profileId: 'wsl:Ubuntu',
    })
    f.spawn.mockImplementationOnce(async input => {
      throw new Error(`Failed to spawn: ${input.args.join(' ')}`)
    })
    const result = await f.invoke('grant', launchRequest(route))
    expect(result).toMatchObject({ ok: false, error: { code: 'agent.launch_failed' } })
    expect(JSON.stringify(result)).not.toContain(serializedKey)
    expect(f.hub.listSessions().sessions).toEqual([])
  },
)

it('does not spawn after a direct grant caller ends during launch preparation', async () => {
  let closed = false
  const f = await createLaunchWorker({
    name: 'worker',
    fullAccess: false,
    reuse: false,
    assertActive: () => {
      if (closed) {
        throw createAppError('control_surface.unauthorized')
      }
    },
  })
  const prepare = f.plan.getMockImplementation()!
  f.plan.mockImplementationOnce(async input => {
    const plan = await prepare(input)
    closed = true
    return plan
  })
  expect(await f.invoke('grant', launchRequest('direct'))).toMatchObject({
    ok: false,
    error: { code: 'control_surface.unauthorized' },
  })
  expect(f.spawn).not.toHaveBeenCalled()
  expect(f.hub.listSessions().sessions).toEqual([])
})

it('does not reflect private error details from an older remote Worker', async () => {
  const home = await createLaunchWorker({
    name: 'home',
    fullAccess: false,
    reuse: false,
    remote: true,
  })
  seam.remote.mockImplementation(async (_endpoint, request) => ({
    result:
      request.id === 'workspace.approveRoot'
        ? { ok: true, value: null }
        : {
            ok: false,
            error: {
              code: 'agent.launch_failed',
              debugMessage: savedKey,
              details: { argv: [savedKey] },
            },
          },
  }))
  const result = await home.invoke(
    'bearer',
    launchRequest('mount', { env: { S1A_TEST_API_KEY: savedKey } }),
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'agent.launch_failed' } })
  expect(JSON.stringify(result)).not.toContain(serializedKey)
  expect(home.hub.listSessions().sessions).toEqual([])
})

it.each(['pty.spawn', 'pty.spawnInMount'] as const)(
  'keeps private environment out of %s failures',
  async id => {
    seam.platform = 'win32'
    const f = await createLaunchWorker({ name: 'worker', fullAccess: false, reuse: false })
    f.spawn.mockImplementationOnce(async input => {
      throw new Error(input.args.join(' '))
    })
    const result = await f.invoke('bearer', {
      kind: 'command',
      id,
      payload: {
        ...(id === 'pty.spawn' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
        command: 'fixture-agent',
        profileId: 'wsl:Ubuntu',
        env: { S1A_TEST_API_KEY: savedKey },
        cols: 80,
        rows: 24,
      },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'terminal.spawn_failed' } })
    expect(JSON.stringify(result)).not.toContain(serializedKey)
    expect(f.hub.listSessions().sessions).toEqual([])
  },
)
