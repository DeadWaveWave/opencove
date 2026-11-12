import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { AppStateCommittedObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ManagedClaudeFaultModel, FallbackStep } from './managedClaudeFaultModel'
import type { ManagedClaudeFaultOracle } from './managedClaudeFaultOracle'
import type { ShellCase } from './managedClaudeFallbackFaultCases'
import { shellAppState } from './managedClaudeFallbackFaultContext'

export function fallbackFaultStorage(input: {
  model: ManagedClaudeFaultModel
  peer: ManagedClaudeFaultModel
  models: ManagedClaudeFaultModel[]
  config: ShellCase
  oracle: ManagedClaudeFaultOracle
  name(): string
  node(id?: string): ManagedClaudeFaultModel
  boundary(step: FallbackStep, side: 'before' | 'after'): void
  fail(point: ShellCase['fault']): void
  commits: Set<(event: AppStateCommittedObservation) => void>
}): PersistenceStore {
  const { model, peer, models, config, oracle, name, node, boundary, fail, commits } = input
  return {
    readAppState: async () => {
      const state = shellAppState(model, peer, config)
      oracle.identity(name())
      return state
    },
    observeManagedClaudeNode: (id: string) => node(id).observation(id),
    isManagedClaudeRuntimeReferenced: (id: string) => {
      boundary('referenceRead', 'before')
      fail('referenceRead')
      const result = models.some(value => value.referenced(id))
      boundary('referenceRead', 'after')
      return result
    },
    managedClaudePreparationCandidates: (_workspace: string, ids?: string[]) =>
      models
        .filter(value => value.present && (!ids || ids.includes(value.nodeId)))
        .map(value => value.nodeId),
    onAppStateCommitted: (listener: (event: AppStateCommittedObservation) => void) => {
      commits.add(listener)
      return () => {
        commits.delete(listener)
      }
    },
    activateManagedClaudeRuntime: async activation => {
      oracle.effect(name())
      return node(activation.nodeId).activate(activation)
    },
  } as PersistenceStore
}
