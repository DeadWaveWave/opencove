import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type {
  AgentProviderId,
  TerminalAgentActivitySnapshot,
  TerminalAgentReexecInput,
} from '../../../src/shared/contracts/dto'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

function createWebSocketHarness(): {
  ws: WebSocket
  messages: Array<Record<string, unknown>>
} {
  const messages: Array<Record<string, unknown>> = []
  return {
    messages,
    ws: {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 0,
      send: (raw: string) => messages.push(JSON.parse(raw) as Record<string, unknown>),
      close: vi.fn(),
    } as unknown as WebSocket,
  }
}

const activity: TerminalAgentActivitySnapshot = {
  provider: 'codex',
  invocationId: 'invocation-1',
  generation: 1,
  phase: 'active',
  observedAtMs: 1_000,
  identityAuthority: 'provider_session_start',
  sourceRevision: 1,
  revision: 1,
}

const input: TerminalAgentReexecInput = {
  sessionId: 'session-1',
  operationId: 'operation-1',
  provider: 'codex',
  resumeSessionId: 'provider-session-1',
  expectedActivity: {
    provider: activity.provider,
    invocationId: activity.invocationId,
    generation: activity.generation,
    phase: activity.phase,
    observedAtMs: activity.observedAtMs,
    sourceRevision: activity.sourceRevision,
    revision: activity.revision,
  },
  authorityEpoch: 1,
}

function createHarness(
  options: {
    activity?: TerminalAgentActivitySnapshot | null
    agentProvider?: AgentProviderId
  } = {},
) {
  const reexecAgent = vi.fn(async request => ({
    sessionId: request.sessionId,
    operationId: request.operationId,
    status: 'reexecuted' as const,
  }))
  const hub = new PtyStreamHub({
    replayWindowMaxBytes: 64_000,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      reexecAgent,
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
    },
  })
  hub.registerSessionMetadata({
    sessionId: input.sessionId,
    kind: 'terminal',
    startedAt: '2026-09-01T00:00:00.000Z',
    cwd: '/tmp',
    command: 'shell',
    args: [],
    cols: 80,
    rows: 24,
  })
  const registeredActivity = options.activity === undefined ? activity : options.activity
  hub.registerSessionAgentMetadata({
    sessionId: input.sessionId,
    resumeSessionId: registeredActivity ? 'provider-session-1' : null,
    agentProvider: options.agentProvider ?? registeredActivity?.provider ?? 'codex',
    ...(registeredActivity ? { terminalAgentActivity: registeredActivity } : {}),
  })
  return { hub, reexecAgent }
}

async function attachController(hub: PtyStreamHub, clientId: string) {
  const client = createWebSocketHarness()
  hub.registerClient({ clientId, kind: 'web', ws: client.ws })
  hub.attach({ clientId, sessionId: input.sessionId, role: 'controller' })
  await hub.drainRecoveryOperations()
  return client
}

describe('PtyStreamHub terminal Agent re-exec', () => {
  it('serializes an exact activity-fenced request for the current controller', async () => {
    const { hub, reexecAgent } = createHarness()
    const client = await attachController(hub, 'controller')

    await expect(hub.reexecAgent({ ...input, clientId: 'controller' })).resolves.toEqual({
      sessionId: input.sessionId,
      operationId: input.operationId,
      status: 'reexecuted',
    })
    expect(reexecAgent).toHaveBeenCalledWith(input)
    expect(client.messages.at(-1)).toEqual({
      type: 'agent_reexec_result',
      sessionId: input.sessionId,
      operationId: input.operationId,
      status: 'reexecuted',
    })
  })

  it('rejects stale activity before touching the runtime', async () => {
    const { hub, reexecAgent } = createHarness()
    await attachController(hub, 'controller')

    await expect(
      hub.reexecAgent({
        ...input,
        clientId: 'controller',
        expectedActivity: { ...input.expectedActivity!, revision: 99 },
      }),
    ).resolves.toMatchObject({ status: 'rejected_stale_activity' })
    expect(reexecAgent).not.toHaveBeenCalled()
  })

  it('binds null-activity fallback re-exec to the Worker-observed provider', async () => {
    const { hub, reexecAgent } = createHarness({ activity: null, agentProvider: 'pi' })
    await attachController(hub, 'controller')

    await expect(
      hub.reexecAgent({
        ...input,
        clientId: 'controller',
        operationId: 'operation-cross-provider',
        provider: 'codex',
        resumeSessionId: null,
        expectedActivity: null,
      }),
    ).resolves.toMatchObject({ status: 'rejected_stale_activity' })
    await expect(
      hub.reexecAgent({
        ...input,
        clientId: 'controller',
        operationId: 'operation-same-provider',
        provider: 'pi',
        resumeSessionId: null,
        expectedActivity: null,
      }),
    ).resolves.toMatchObject({ status: 'reexecuted' })
    expect(reexecAgent).toHaveBeenCalledOnce()
  })

  it('rejects a viewer and missing or stale authority epochs', async () => {
    const { hub, reexecAgent } = createHarness()
    await attachController(hub, 'controller')
    const viewer = createWebSocketHarness()
    hub.registerClient({ clientId: 'viewer', kind: 'web', ws: viewer.ws })
    hub.attach({ clientId: 'viewer', sessionId: input.sessionId, role: 'viewer' })
    await hub.drainRecoveryOperations()

    await expect(hub.reexecAgent({ ...input, clientId: 'viewer' })).resolves.toMatchObject({
      status: 'rejected_not_controller',
    })
    await expect(
      hub.reexecAgent({ ...input, clientId: 'controller', authorityEpoch: undefined }),
    ).resolves.toMatchObject({ status: 'rejected_stale_authority' })
    await expect(
      hub.reexecAgent({ ...input, clientId: 'controller', authorityEpoch: 0 }),
    ).resolves.toMatchObject({ status: 'rejected_stale_authority' })
    expect(reexecAgent).not.toHaveBeenCalled()
  })
})
