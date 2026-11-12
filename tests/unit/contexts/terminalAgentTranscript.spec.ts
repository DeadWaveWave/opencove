// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createSessionNodeResolver } from '../../../src/app/main/controlSurface/handlers/sessionNodeResolver'
import { registerSessionFinalMessageHandler } from '../../../src/app/main/controlSurface/handlers/sessionFinalMessageHandler'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { AgentRunSnapshot } from '../../../src/shared/contracts/dto/agentRunState'
import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'
import { resolveSessionFilePath } from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator', () => ({
  locateAgentResumeSessionId: vi.fn(async () => 'observed-conversation'),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver', () => ({
  resolveSessionFilePath: vi.fn(async () => '/fixture/transcript'),
}))
vi.mock('../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage', () => ({
  readLastAssistantMessageFromSessionFile: vi.fn(async () => 'terminal reply'),
}))
afterEach(() => vi.clearAllMocks())

function fixture(provider: AgentRunSnapshot['provider'] | null, binding: unknown = null) {
  const node = {
    id: 'terminal',
    kind: 'terminal',
    sessionId: 'shell-session',
    startedAt: '2026-03-27T00:00:00.000Z',
    agent: binding,
  }
  const observeAgentState = vi.fn(() => (provider ? { provider } : null))
  const topology = { listMounts: async () => ({ mounts: [] }) } as unknown as WorkerTopologyStore
  const resolveNode = createSessionNodeResolver({
    getPersistenceStore: async () =>
      ({
        readAppState: async () => ({
          workspaces: [{ id: 'workspace', path: '/repo', nodes: [node] }],
        }),
      }) as PersistenceStore,
    topology,
    ptyRuntime: { getSessionRoute: () => ({ kind: 'local' }) } as never,
    ptyStreamHub: { getSessionMetadata: () => null, observeAgentState } as unknown as PtyStreamHub,
  })
  const surface = createControlSurface()
  registerSessionFinalMessageHandler(surface, { sessions: new Map(), topology, resolveNode })
  const read = () =>
    surface.invoke({} as ControlSurfaceContext, {
      kind: 'query',
      id: 'session.finalMessage',
      payload: { nodeId: node.id },
    })
  return { node, read, resolveNode, observeAgentState }
}

it.each(['codex', 'claude-code'] as const)(
  'reads a %s terminal transcript using current run-state provider',
  async provider => {
    const f = fixture(provider)
    expect(await f.resolveNode('terminal')).toMatchObject({
      value: { provider, prompt: null, model: null },
    })
    expect(f.observeAgentState).toHaveBeenCalledWith('shell-session')
    expect(await f.read()).toMatchObject({
      ok: true,
      value: { provider, message: 'terminal reply' },
    })
    expect(locateAgentResumeSessionId).toHaveBeenCalledWith(
      expect.objectContaining({ provider, cwd: '/repo' }),
    )
  },
)

it('reads a recovered terminal overlay from its verified conversation binding', async () => {
  const f = fixture(null, {
    provider: 'claude-code',
    resumeSessionId: 'bound-conversation',
    resumeSessionIdVerified: true,
  })
  expect(await f.read()).toMatchObject({
    ok: true,
    value: {
      provider: 'claude-code',
      resumeSessionId: 'bound-conversation',
      message: 'terminal reply',
    },
  })
  expect(locateAgentResumeSessionId).not.toHaveBeenCalled()
})

it('prefers the run provider over a stale terminal overlay and never reuses its conversation', async () => {
  const f = fixture('codex', {
    provider: 'claude-code',
    resumeSessionId: 'stale-conversation',
    resumeSessionIdVerified: true,
  })
  expect(await f.read()).toMatchObject({
    ok: true,
    value: { provider: 'codex', resumeSessionId: 'observed-conversation' },
  })
  expect(resolveSessionFilePath).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'codex', sessionId: 'observed-conversation' }),
  )
})

it('does not treat an ordinary terminal as an agent conversation', async () => {
  const f = fixture(null)
  expect(await f.read()).toMatchObject({ ok: false, error: { code: 'session.not_found' } })
  expect(resolveSessionFilePath).not.toHaveBeenCalled()
})

it('does not infer a conversation from an unverified terminal provider hint', async () => {
  const f = fixture(null, {
    provider: 'codex',
    resumeSessionId: 'unverified',
    resumeSessionIdVerified: false,
  })
  expect(await f.read()).toMatchObject({ ok: false, error: { code: 'session.not_found' } })
  expect(resolveSessionFilePath).not.toHaveBeenCalled()
})
