import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { RemotePtyEndpointProxy } from '../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type {
  TerminalForegroundEvent,
  TerminalSessionMetadataEvent,
} from '../../../src/shared/contracts/dto'

function createLocalRuntime(): ControlSurfacePtyRuntime {
  return {
    spawnSession: vi.fn(async () => ({ sessionId: 'local-session' })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
  }
}

describe('multi-endpoint terminal Agent runtime projection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('combines registry metadata with local foreground evidence during re-exec', async () => {
    let foregroundListener: ((event: TerminalForegroundEvent) => void) | null = null
    let metadataListener: ((event: TerminalSessionMetadataEvent) => void) | null = null
    const base = createLocalRuntime()
    const localRuntime: ControlSurfacePtyRuntime = {
      ...base,
      onForeground: listener => {
        foregroundListener = listener
        return () => {
          foregroundListener = null
        }
      },
      write: vi.fn((_sessionId, data) => {
        if (data !== '\u0003') {
          return
        }
        metadataListener?.({
          sessionId: 'local-session',
          resumeSessionId: 'provider-session-1',
          terminalAgentActivity: {
            provider: 'codex',
            invocationId: 'invocation-1',
            generation: 1,
            phase: 'exited',
            observedAtMs: 101,
            identityAuthority: 'provider_session_start',
            sourceRevision: 2,
            revision: 2,
          },
        })
        foregroundListener?.({
          sessionId: 'local-session',
          observedAtMs: Date.now() + 1,
          source: 'process_scan',
          exitCode: null,
          availability: 'available',
          agent: null,
          shellOnly: true,
        })
      }),
    }
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime,
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
      agentMetadataSources: [
        {
          onMetadata: listener => {
            metadataListener = listener
            return () => {
              metadataListener = null
            }
          },
        },
      ],
    })
    await runtime.spawnSession({ cwd: '/tmp', command: 'shell', args: [], cols: 80, rows: 24 })

    await expect(
      runtime.reexecAgent?.({
        sessionId: 'local-session',
        operationId: 'operation-local',
        provider: 'codex',
        resumeSessionId: 'provider-session-1',
        expectedActivity: {
          provider: 'codex',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'active',
          observedAtMs: 100,
          sourceRevision: 1,
          revision: 1,
        },
      }),
    ).resolves.toMatchObject({ status: 'reexecuted' })
    expect(localRuntime.write).toHaveBeenNthCalledWith(
      2,
      'local-session',
      '\u0015codex resume provider-session-1\r',
    )
    runtime.dispose()
  })

  it('actively confirms a fresh shell prompt when the fenced invocation already exited', async () => {
    let foregroundListener: ((event: TerminalForegroundEvent) => void) | null = null
    const localRuntime: ControlSurfacePtyRuntime = {
      ...createLocalRuntime(),
      onForeground: listener => {
        foregroundListener = listener
        return () => {
          foregroundListener = null
        }
      },
      write: vi.fn(),
      probeForeground: vi.fn(() => {
        foregroundListener?.({
          sessionId: 'local-session',
          observedAtMs: Date.now() + 1,
          source: 'process_scan',
          exitCode: null,
          availability: 'available',
          agent: null,
          shellOnly: true,
        })
      }),
    }
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime,
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })
    await runtime.spawnSession({ cwd: '/tmp', command: 'shell', args: [], cols: 80, rows: 24 })

    await expect(
      runtime.reexecAgent?.({
        sessionId: 'local-session',
        operationId: 'operation-exited',
        provider: 'codex',
        resumeSessionId: 'provider-session-1',
        expectedActivity: {
          provider: 'codex',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'exited',
          observedAtMs: 120,
          sourceRevision: 2,
          revision: 2,
        },
      }),
    ).resolves.toMatchObject({ status: 'reexecuted' })
    expect(localRuntime.write).toHaveBeenNthCalledWith(1, 'local-session', '\u0015cd .\r')
    expect(localRuntime.probeForeground).toHaveBeenCalledWith('local-session')
    expect(localRuntime.write).toHaveBeenNthCalledWith(
      2,
      'local-session',
      '\u0015codex resume provider-session-1\r',
    )
    runtime.dispose()
  })

  it('publishes the Worker-observed provider before starting a fallback watcher', async () => {
    const startSessionStateWatcher = vi.fn()
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: { ...createLocalRuntime(), startSessionStateWatcher },
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })
    const metadataListener = vi.fn()
    runtime.onMetadata?.(metadataListener)
    await runtime.spawnSession({ cwd: '/tmp', command: 'shell', args: [], cols: 80, rows: 24 })

    runtime.startSessionStateWatcher?.({
      sessionId: 'local-session',
      provider: 'pi',
      cwd: '/tmp',
      launchMode: 'resume',
      resumeSessionId: 'pi-session-1',
      startedAtMs: 100,
    })

    expect(metadataListener).toHaveBeenCalledWith({
      sessionId: 'local-session',
      resumeSessionId: 'pi-session-1',
      agentProvider: 'pi',
    })
    expect(startSessionStateWatcher).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it('routes a fenced re-exec to the remote session and maps the result home', async () => {
    vi.spyOn(RemotePtyEndpointProxy.prototype, 'attach').mockImplementation(() => undefined)
    const reexecAgent = vi
      .spyOn(RemotePtyEndpointProxy.prototype, 'reexecAgent')
      .mockImplementation(async input => ({
        sessionId: input.sessionId,
        operationId: input.operationId,
        status: 'reexecuted',
      }))
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: createLocalRuntime(),
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })
    const homeSessionId = runtime.registerRemoteSession({
      endpointId: 'endpoint-1',
      remoteSessionId: 'remote-session-1',
    })

    await expect(
      runtime.reexecAgent?.({
        sessionId: homeSessionId,
        operationId: 'operation-1',
        provider: 'codex',
        resumeSessionId: 'provider-session-1',
        expectedActivity: null,
        authorityEpoch: 9,
      }),
    ).resolves.toEqual({
      sessionId: homeSessionId,
      operationId: 'operation-1',
      status: 'reexecuted',
    })
    expect(reexecAgent).toHaveBeenCalledWith({
      sessionId: 'remote-session-1',
      operationId: 'operation-1',
      provider: 'codex',
      resumeSessionId: 'provider-session-1',
      expectedActivity: null,
      authorityEpoch: 9,
    })
    runtime.dispose()
  })

  it('translates remote raw state and activity metadata to the durable home session id', () => {
    const attach = vi
      .spyOn(RemotePtyEndpointProxy.prototype, 'attach')
      .mockImplementation(() => undefined)
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: createLocalRuntime(),
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: runtime,
    })
    runtime.onMetadata?.(event => hub.registerSessionAgentMetadata(event))
    const stateListener = vi.fn()
    runtime.onState?.(stateListener)

    const homeSessionId = runtime.registerRemoteSession({
      endpointId: 'endpoint-1',
      remoteSessionId: 'remote-session-1',
    })
    hub.registerSessionMetadata({
      sessionId: homeSessionId,
      kind: 'terminal',
      startedAt: '2026-09-01T00:00:00.000Z',
      cwd: '/remote',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })

    const internals = attach.mock.instances[0] as unknown as {
      handleMessage: (raw: string) => void
    }
    internals.handleMessage(
      JSON.stringify({
        type: 'state',
        sessionId: 'remote-session-1',
        state: 'working',
        source: 'claude_hook',
        hookInstallState: 'installed',
        observedAtMs: 1_234,
      }),
    )
    internals.handleMessage(
      JSON.stringify({
        type: 'metadata',
        sessionId: 'remote-session-1',
        resumeSessionId: 'provider-session-1',
        terminalAgentActivity: {
          provider: 'claude-code',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'active',
          observedAtMs: 1_235,
          identityAuthority: 'provider_session_start',
          sourceRevision: 2,
          revision: 3,
        },
      }),
    )

    expect(stateListener).toHaveBeenCalledWith({
      sessionId: homeSessionId,
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
      observedAtMs: 1_234,
    })
    expect(hub.listTerminalAgentActivityMetadata()).toEqual({
      entries: [
        {
          sessionId: homeSessionId,
          resumeSessionId: 'provider-session-1',
          terminalAgentActivity: {
            provider: 'claude-code',
            invocationId: 'invocation-1',
            generation: 1,
            phase: 'active',
            observedAtMs: 1_235,
            identityAuthority: 'provider_session_start',
            sourceRevision: 2,
            revision: 3,
          },
        },
      ],
    })

    runtime.dispose()
  })
})
