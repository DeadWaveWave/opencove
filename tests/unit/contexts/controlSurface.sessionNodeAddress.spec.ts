import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from './controlSurfaceTestTerminalAvailability'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-03-27T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: {
      state: true,
      events: true,
    },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: {
        viewer: true,
        controller: true,
      },
      webAuth: {
        ticketToCookie: true,
        cookieSession: true,
      },
    },
  },
}

function createStubStore(state: unknown) {
  return {
    readWorkspaceStateRaw: async () => null,
    writeWorkspaceStateRaw: async () => ({ ok: true, level: 'full', bytes: 0 }),
    readAppState: async () => state,
    writeAppState: async () => ({ ok: true, level: 'full', bytes: 1 }),
    readNodeScrollback: async () => null,
    writeNodeScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
    consumeRecovery: () => null,
    dispose: () => undefined,
  }
}

function createTopologyStub() {
  return {
    listMounts: async () => ({ projectId: 'ws1', mounts: [] }),
  } as never
}

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator', () => ({
  locateAgentResumeSessionId: vi.fn(async () => 'conversation'),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver', () => ({
  resolveSessionFilePath: vi.fn(async () => '/fixture/transcript'),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage', () => ({
  readLastAssistantMessageFromSessionFile: vi.fn(async () => 'done'),
}))
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

describe('node session addressing', () => {
  it('resolves UI and revived bindings without a launch map', async () => {
    const appState = {
      formatVersion: 1,
      activeWorkspaceId: 'ws1',
      workspaces: [
        {
          id: 'ws1',
          name: 'Workspace',
          path: '/repo',
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [
            {
              id: 's1',
              name: 'Space A',
              directoryPath: '/repo',
              labelColor: null,
              nodeIds: [],
              rect: null,
            },
          ],
          activeSpaceId: null,
          nodes: [
            {
              id: 'node',
              kind: 'agent',
              sessionId: 'ui-session',
              startedAt: '2026-03-27T00:00:00.000Z',
              agent: {
                provider: 'codex',
                executionDirectory: '/repo',
                prompt: 'hello',
                resumeSessionId: 'conversation',
              },
            },
          ],
          spaceArchiveRecords: [],
        },
      ],
      settings: {},
    }

    const killed = vi.fn()
    const store = createStubStore(appState)
    const readAppState = vi.spyOn(store, 'readAppState')
    let controlSurface = createControlSurface()
    const ptyStreamHub: Pick<
      PtyStreamHub,
      'registerSessionMetadata' | 'hasSession' | 'getSessionMetadata'
    > = {
      registerSessionMetadata: () => undefined,
      hasSession: () => true,
      getSessionMetadata: () => null,
    }
    const register = () =>
      registerSessionHandlers(controlSurface, {
        ...createReadyTerminalAdmissionDeps(),
        agentProviderRegistry: createTestAgentProviderRegistry(),
        userDataPath: '/tmp/opencove-test-user-data',
        approvedWorkspaces: {
          registerRoot: async () => undefined,
          isPathApproved: async () => true,
        },
        getPersistenceStore: async () => store,
        ptyRuntime: {
          spawnSession: async () => ({ sessionId: 'pty-1' }),
          write: () => undefined,
          resize: () => undefined,
          kill: killed,
          onData: () => () => undefined,
          onExit: () => () => undefined,
          attach: () => undefined,
          detach: () => undefined,
          snapshot: () => '',
          startSessionStateWatcher: () => undefined,
          dispose: () => undefined,
        },
        ptyStreamHub: ptyStreamHub as unknown as PtyStreamHub,
        topology: createTopologyStub(),
      })

    register()
    const invoke = (id: string, payload: unknown) =>
      controlSurface.invoke(ctx, { kind: id === 'session.kill' ? 'command' : 'query', id, payload })
    expect(await invoke('session.get', { nodeId: 'node' })).toMatchObject({
      ok: true,
      value: {
        nodeId: 'node',
        sessionId: 'ui-session',
        provider: 'codex',
        command: null,
        args: null,
      },
    })
    expect(await invoke('session.finalMessage', { nodeId: 'node' })).toMatchObject({
      ok: true,
      value: { message: 'done' },
    })
    expect(await invoke('session.kill', { nodeId: 'node' })).toMatchObject({ ok: true })
    expect(killed).toHaveBeenLastCalledWith('ui-session')
    // Legacy lookup still uses the launch map; kill also accepts a live PTY without a launch record.
    await Promise.all(
      ['session.get', 'session.finalMessage'].map(async id => {
        expect(await invoke(id, { sessionId: ' ui-session ' })).toMatchObject({
          ok: false,
          error: { code: 'session.not_found' },
        })
      }),
    )
    expect(await invoke('session.kill', { sessionId: ' ui-session ' })).toMatchObject({ ok: true })
    expect(killed).toHaveBeenLastCalledWith('ui-session')
    // A fresh handler has no launch records; the persisted replacement is authoritative.
    appState.workspaces[0].nodes[0].sessionId = 'revived-session'
    controlSurface = createControlSurface()
    register()
    expect(await invoke('session.get', { nodeId: 'node' })).toMatchObject({
      ok: true,
      value: { sessionId: 'revived-session' },
    })
    expect(await invoke('session.kill', { nodeId: 'node' })).toMatchObject({ ok: true })
    expect(killed).toHaveBeenLastCalledWith('revived-session')
    appState.workspaces[0].nodes[0].agent.resumeSessionId = ''
    expect(await invoke('session.finalMessage', { nodeId: 'node' })).toMatchObject({
      ok: true,
      value: { message: 'done', sessionId: 'revived-session' },
    })
    await Promise.all(
      ['session.get', 'session.finalMessage', 'session.kill'].map(async id => {
        await Promise.all(
          [{}, { nodeId: 'node', sessionId: 'ui-session' }, { nodeId: '  ' }].map(async payload => {
            expect(await invoke(id, payload)).toMatchObject({
              ok: false,
              error: { code: 'common.invalid_input' },
            })
          }),
        )
        expect(await invoke(id, { nodeId: 'missing' })).toMatchObject({
          ok: false,
          error: { code: 'session.not_found' },
        })
      }),
    )
    vi.mocked(resolveSessionFilePath).mockResolvedValueOnce(null)
    expect(await invoke('session.finalMessage', { nodeId: 'node' })).toMatchObject({
      ok: false,
      error: { code: 'session.transcript_not_ready' },
    })
    appState.workspaces[0].nodes[0].kind = 'terminal'
    expect(await invoke('session.get', { nodeId: 'node' })).toMatchObject({
      ok: true,
      value: { provider: null, prompt: null },
    })
    expect(await invoke('session.finalMessage', { nodeId: 'node' })).toMatchObject({
      ok: false,
      error: { code: 'session.not_found' },
    })
    expect(await invoke('session.kill', { nodeId: 'node' })).toMatchObject({ ok: true })
    killed.mockClear()
    readAppState.mockResolvedValueOnce(appState).mockImplementationOnce(async () => {
      appState.workspaces[0].nodes[0].sessionId = 'replacement-session'
      return appState
    })
    expect(await invoke('session.kill', { nodeId: 'node' })).toMatchObject({
      ok: false,
      error: { code: 'common.invalid_input' },
    })
    expect(killed).not.toHaveBeenCalled()
    appState.workspaces[0].nodes[0].sessionId = ''
    expect(await invoke('session.get', { nodeId: 'node' })).toMatchObject({
      ok: false,
      error: { code: 'session.not_found' },
    })
  })
})
