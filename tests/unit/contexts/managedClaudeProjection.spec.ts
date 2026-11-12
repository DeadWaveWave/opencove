import { afterEach, expect, it } from 'vitest'
import { acceptManagedClaudeObservation } from '@contexts/workspace/presentation/renderer/utils/managedClaudeProjection'
import { markPersistedStateAsSynced } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
const original = window.opencoveApi
afterEach(() =>
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original }),
)
it('orders tuple observations by canonical revision and rejects equal-revision disagreement', () => {
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: { persistence: {} } })
  markPersistedStateAsSynced(
    { formatVersion: 1, activeWorkspaceId: null, workspaces: [], settings: DEFAULT_AGENT_SETTINGS },
    5,
  )
  const observation = {
    nodeId: 'node',
    activationId: 'a',
    runtimeSessionId: 'runtime',
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
    nodeSeen: true,
    bindingRevision: 1,
    observedRevision: 4,
  }
  const context = { operationIsCurrent: true, nodeStillPresent: true, acceptedSnapshotRevision: 5 }
  expect(acceptManagedClaudeObservation('node', observation, context)).toBe('stale')
  expect(
    acceptManagedClaudeObservation('node', { ...observation, observedRevision: 6 }, context),
  ).toBe('accepted')
  expect(
    acceptManagedClaudeObservation(
      'node',
      { ...observation, observedRevision: 6, activationId: 'other' },
      context,
    ),
  ).toBe('resync-required')
  expect(
    acceptManagedClaudeObservation(
      'node',
      { ...observation, observedRevision: 7 },
      { ...context, nodeStillPresent: false },
    ),
  ).toBe('stale')
})
