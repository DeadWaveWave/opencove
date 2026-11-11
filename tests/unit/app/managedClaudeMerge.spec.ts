import { afterEach, expect, it } from 'vitest'
import { resolveWorkspacesForWorkerSync } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import {
  toShellWorkspaceState,
  mergeHydratedNode,
} from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { guardNodeFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { markPersistedStateAsSynced } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
const original = window.opencoveApi
afterEach(() =>
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original }),
)
function fixture(id: string, owned: boolean, runtime: string | null = 'runtime') {
  return ensurePersistedWorkspace({
    id: 'project',
    name: 'Project',
    path: '/repo',
    spaces: [],
    nodes: [
      {
        id,
        kind: 'agent',
        sessionId: 'runtime',
        title: 'Claude',
        width: 500,
        height: 400,
        position: { x: 0, y: 0 },
        ...(owned
          ? {
              managedClaudeResumeBindingOwnership: {
                activationId: 'activation',
                runtimeSessionId: runtime,
              },
            }
          : {}),
        agent: {
          provider: 'claude-code',
          executionDirectory: '/repo',
          resumeSessionId: 'B',
          resumeSessionIdVerified: true,
        },
      },
    ],
  })!
}
it.each([
  'normal',
  'guarded',
  'guarded without base',
  'guarded preparing',
  'preparing',
  'publishing',
  'settled shell',
] as const)('projects owned tuples last through %s', branch => {
  const id = `owned-${branch}`
  const canonical = fixture(id, true, branch === 'settled shell' ? null : 'runtime')
  const local = toShellWorkspaceState(structuredClone(canonical))
  local.nodes[0].data.agent!.resumeSessionId = 'A'
  if (branch.includes('guarded')) {
    guardNodeFromSyncOverwrite(id)
  }
  if (branch.includes('preparing')) {
    local.nodes[0].data.runtimeSessionBinding = { phase: 'preparing', sessionId: 'runtime' }
    local.nodes[0].data.sessionId = ''
  }
  if (branch === 'publishing' || branch === 'settled shell') {
    local.nodes[0].data.runtimeSessionBinding = { phase: 'publishing', sessionId: 'shell' }
    local.nodes[0].data.sessionId = 'shell'
  }
  const base =
    branch === 'guarded without base' || branch === 'guarded preparing'
      ? null
      : toPersistedState([toShellWorkspaceState(canonical)], canonical.id)
  const result = resolveWorkspacesForWorkerSync({
    currentWorkspaces: [local],
    persistedWorkspaces: [canonical],
    baseState: base,
  })[0]
  expect(result.nodes[0].data.agent?.resumeSessionId).toBe('B')
  expect(result.nodes[0].data.managedClaudeResumeBindingOwnership).toEqual(
    canonical.nodes[0].managedClaudeResumeBindingOwnership,
  )
  const serialized = toPersistedState([result], canonical.id).workspaces[0].nodes[0]
  expect(serialized.sessionId).toBe(branch === 'settled shell' ? 'shell' : 'runtime')
  if (branch.includes('preparing')) {
    expect(result.nodes[0].data.sessionId).toBe('')
  }
})
it('preserves unowned local verified binding in the normal merge', () => {
  const canonical = fixture('unowned', false),
    local = toShellWorkspaceState(structuredClone(canonical))
  local.nodes[0].data.agent!.resumeSessionId = 'A'
  expect(
    resolveWorkspacesForWorkerSync({
      currentWorkspaces: [local],
      persistedWorkspaces: [canonical],
      baseState: null,
    })[0].nodes[0].data.agent?.resumeSessionId,
  ).toBe('A')
})
it('attaches an old same-runtime preparation using the newer canonical tuple', () => {
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: { persistence: {} } })
  const canonical = fixture('prepared', true),
    current = toShellWorkspaceState(canonical).nodes[0]
  markPersistedStateAsSynced(toPersistedState([toShellWorkspaceState(canonical)], canonical.id), 5)
  const delayed = structuredClone(current)
  delayed.data.agent!.resumeSessionId = 'A'
  delayed.data.managedClaudeBindingObservation = {
    nodeId: current.id,
    activationId: 'activation',
    runtimeSessionId: 'runtime',
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
    nodeSeen: true,
    bindingRevision: 2,
    observedRevision: 2,
  }
  expect(mergeHydratedNode(current, delayed).data.agent?.resumeSessionId).toBe('B')
})
