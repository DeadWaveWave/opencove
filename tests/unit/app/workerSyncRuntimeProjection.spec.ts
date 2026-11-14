import { afterEach, expect, it, vi } from 'vitest'
import { resolveWorkspacesForWorkerSync } from '@app/renderer/shell/hooks/workerSync/refreshState'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import * as guards from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { resolveAgentPresentation } from '@contexts/workspace/presentation/renderer/utils/agentPresentation'

afterEach(() => vi.restoreAllMocks())
function fixture() {
  const canonical = ensurePersistedWorkspace({
    id: 'project',
    name: 'Background',
    path: '/repo',
    spaces: [],
    nodes: [
      {
        id: 'agent',
        kind: 'agent',
        sessionId: 'runtime',
        title: 'Agent',
        width: 500,
        height: 400,
        position: { x: 0, y: 0 },
        status: 'running',
        agent: {
          provider: 'claude-code',
          prompt: 'Original',
          model: 'original-model',
          effectiveModel: 'actual-model',
          launchMode: 'resume',
          resumeSessionId: 'session-A',
          resumeSessionIdVerified: true,
          executionDirectory: '/repo',
          expectedDirectory: '/repo',
          taskId: null,
          agentFullAccess: false,
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
        },
      },
    ],
  })!
  const canonicalAgent = canonical.nodes[0].agent
  if (!canonicalAgent || !('taskId' in canonicalAgent)) {
    throw new Error('Expected agent fixture')
  }
  const local = toShellWorkspaceState(structuredClone(canonical))
  const base = toPersistedState([local], 'project')
  const observation = {
    status: 'waiting' as const,
    blockedReason: 'permission' as const,
    source: 'claude_hook' as const,
    hookInstallState: 'installed' as const,
    degraded: false,
  }
  local.nodes[0].data.agentRuntimeObservation = observation
  const apply = (hasBase = true) =>
    resolveWorkspacesForWorkerSync({
      currentWorkspaces: [local],
      persistedWorkspaces: [canonical],
      baseState: hasBase ? base : null,
    })[0].nodes[0].data
  return { canonical, canonicalAgent, local, base, observation, apply }
}

it.each(
  [false, true].flatMap(guarded =>
    ['preparing', 'publishing', 'legacy'].map(phase => ({ guarded, phase })),
  ),
)('keeps durable fields from rebase during $phase (guard=$guarded)', ({ guarded, phase }) => {
  const f = fixture()
  vi.spyOn(guards, 'isNodeGuardedFromSyncOverwrite').mockReturnValue(guarded)
  if (phase === 'preparing') {
    f.local.nodes[0].data.sessionId = ''
    f.local.nodes[0].data.runtimeSessionBinding = { phase: 'preparing', sessionId: 'runtime' }
  } else if (phase === 'publishing') {
    f.local.nodes[0].data.sessionId = 'new-runtime'
    f.local.nodes[0].data.runtimeSessionBinding = { phase: 'publishing', sessionId: 'new-runtime' }
  }
  Object.assign(f.canonical.nodes[0].agent!, {
    provider: 'codex',
    taskId: 'claimed-task',
    prompt: 'Canonical prompt',
    model: 'canonical-model',
    agentFullAccess: true,
    directoryMode: 'custom',
    customDirectory: '/custom',
    shouldCreateDirectory: true,
  })
  const next = f.apply(phase !== 'legacy')
  expect(next.agent).toMatchObject({
    provider: 'codex',
    taskId: 'claimed-task',
    prompt: 'Canonical prompt',
    model: 'canonical-model',
    agentFullAccess: true,
    directoryMode: 'custom',
    customDirectory: '/custom',
    shouldCreateDirectory: true,
  })
  expect(next.agent).toMatchObject({
    resumeSessionId: 'session-A',
    effectiveModel: 'actual-model',
    executionDirectory: '/repo',
  })
})
it('keeps a waiting observation for the same resolved session even when durable data changes', () => {
  const f = fixture()
  f.canonicalAgent.taskId = 'task'
  const next = f.apply()
  expect(next.agentRuntimeObservation).toBe(f.observation)
  expect(resolveAgentPresentation(next)).toMatchObject({
    status: 'waiting',
    observation: { blockedReason: 'permission' },
  })
})
it.each([false, true])(
  'clears the old observation when canonical runtime changes (W8=%s)',
  owned => {
    const f = fixture()
    f.canonical.nodes[0].sessionId = 'replacement'
    if (owned) {
      f.canonical.nodes[0].managedClaudeResumeBindingOwnership = {
        activationId: 'new-activation',
        runtimeSessionId: 'replacement',
      }
      f.canonical.nodes[0].agent!.resumeSessionId = 'session-B'
      f.local.nodes[0].data.runtimeSessionBinding = { phase: 'preparing', sessionId: 'runtime' }
      f.local.nodes[0].data.sessionId = ''
    }
    const next = f.apply()
    expect(next.sessionId).toBe('replacement')
    expect(next.agentRuntimeObservation).toBeNull()
    expect(resolveAgentPresentation(next).status).toBe('running')
    if (owned) {
      expect(next.agent?.resumeSessionId).toBe('session-B')
    }
  },
)
it('keeps preparing observations by their retained runtime ID, not the empty visible ID', () => {
  const f = fixture()
  f.local.nodes[0].data.runtimeSessionBinding = { phase: 'preparing', sessionId: 'runtime' }
  f.local.nodes[0].data.sessionId = ''
  f.canonicalAgent.taskId = 'task'
  const next = f.apply()
  expect(next.sessionId).toBe('')
  expect(next.agentRuntimeObservation).toBe(f.observation)
  expect(next.agent?.taskId).toBe('task')
})
it('clears an unbound observation even when observation is the only projected difference', () => {
  const f = fixture()
  f.local.nodes[0].data.sessionId = ''
  f.canonical.nodes[0].sessionId = ''
  const next = f.apply()
  expect(next).not.toBe(f.local.nodes[0].data)
  expect(next.agentRuntimeObservation).toBeNull()
})
it('does not hide a durable provider-hint change behind node identity reuse', () => {
  const f = fixture()
  f.canonical.nodes[0].terminalProviderHint = 'codex'
  expect(f.apply().terminalProviderHint).toBe('codex')
})
it.each([false, true].flatMap(guarded => ['task', null].map(taskId => ({ guarded, taskId }))))(
  'keeps the W8 tuple and rebased relationship during preparing (guard=$guarded, taskId=$taskId)',
  ({ guarded, taskId }) => {
    const f = fixture()
    vi.spyOn(guards, 'isNodeGuardedFromSyncOverwrite').mockReturnValue(guarded)
    const before = taskId === null ? 'task' : null
    f.local.nodes[0].data.agent!.taskId = before
    const baseAgent = f.base.workspaces[0].nodes[0].agent!
    if ('taskId' in baseAgent) {
      baseAgent.taskId = before
    }
    f.local.nodes[0].data.runtimeSessionBinding = { phase: 'preparing', sessionId: 'runtime' }
    f.local.nodes[0].data.sessionId = ''
    f.canonical.nodes[0].managedClaudeResumeBindingOwnership = {
      activationId: 'activation',
      runtimeSessionId: 'runtime',
    }
    f.canonical.nodes[0].agent!.resumeSessionId = 'session-B'
    f.canonicalAgent.taskId = taskId
    const next = f.apply()
    expect(next.sessionId).toBe('')
    expect(next.agent).toMatchObject({
      taskId,
      provider: 'claude-code',
      resumeSessionId: 'session-B',
      resumeSessionIdVerified: true,
    })
    expect(next.managedClaudeResumeBindingOwnership).toEqual(
      f.canonical.nodes[0].managedClaudeResumeBindingOwnership,
    )
    expect(
      toPersistedState([{ ...f.local, nodes: [{ ...f.local.nodes[0], data: next }] }], 'project')
        .workspaces[0].nodes[0],
    ).toMatchObject({ sessionId: 'runtime', agent: { taskId, resumeSessionId: 'session-B' } })
  },
)
