import { vi } from 'vitest'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ActivateManagedClaudeRuntimeInput } from '../../../src/shared/contracts/managedClaudeResumeBinding'

export function cleanupFixture() {
  const tuple = { resumeSessionId: 'conversation', resumeSessionIdVerified: true }
  const context = { kind: 'agent', provider: 'claude-code', directory: '/repo', route: 'null' }
  let binding: ManagedClaudeBindingObservation | null = {
    nodeId: 'agent',
    activationId: 'settled',
    runtimeSessionId: null,
    tuple,
    nodeSeen: true,
    bindingRevision: 1,
    observedRevision: 1,
  }
  let retired = false,
    unavailable = false,
    referencesUnavailable = false
  const references = new Set(['fallback-shell'])
  const timers: (() => void)[] = []
  const ports = {
    observeNode: vi.fn(() => {
      if (unavailable) {
        throw new Error('confirmation unavailable')
      }
      return {
        nodeId: 'agent',
        binding,
        retired,
        context: retired ? null : context,
        nodeRuntimeSessionId: retired ? null : (binding?.runtimeSessionId ?? 'fallback-shell'),
      }
    }),
    isRuntimeReferenced: vi.fn((id: string) => {
      if (referencesUnavailable) {
        throw new Error('references unavailable')
      }
      return references.has(id)
    }),
    killExactRuntime: vi.fn(async (_id: string) => {}),
    activateManagedClaudeRuntime: vi.fn(async (input: ActivateManagedClaudeRuntimeInput) => {
      binding = {
        nodeId: input.nodeId,
        activationId: input.activationId,
        runtimeSessionId: input.runtimeSessionId,
        tuple: input.tuple,
        nodeSeen: true,
        bindingRevision: 2,
        observedRevision: 2,
      }
      references.clear()
      if (input.runtimeSessionId) {
        references.add(input.runtimeSessionId)
      }
      return { status: 'committed' as const, revision: 2 }
    }),
    createId: () => 'replacement',
    publishCommittedActivation: vi.fn(),
    scheduleReconciliation: (callback: () => void) => {
      timers.push(callback)
      return vi.fn()
    },
  }
  const owner = new ManagedClaudeLaunchOwner(ports)
  return {
    owner,
    ports,
    tuple,
    context,
    timers,
    references,
    setUnavailable: (value: boolean) => {
      unavailable = value
    },
    setReferencesUnavailable: (value: boolean) => {
      referencesUnavailable = value
    },
    remove: () => {
      binding = null
      retired = true
      references.clear()
      owner.noteNodesDeleted(['agent'])
    },
    supersede: () => {
      binding = { ...binding!, activationId: 'winner', runtimeSessionId: 'winner-runtime' }
      references.clear()
      references.add('winner-runtime')
    },
    admit: async () => {
      const attempt = owner.reserve('agent')
      attempt.context = context
      attempt.expected = { activationId: binding!.activationId, tuple }
      await owner.admit(attempt, { provider: 'claude-code', cwd: '/repo', mountId: null })
      return attempt
    },
  }
}
