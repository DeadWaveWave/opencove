import { describe, it, expect, vi } from 'vitest'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ActivateManagedClaudeRuntimeInput } from '../../../src/shared/contracts/managedClaudeResumeBinding'

describe('managed Claude reconciliation finalization', () => {
  it('cleans the originating fallback shell when the next request reconciles before the timer', async () => {
    const tuple = { resumeSessionId: 'conversation', resumeSessionIdVerified: true }
    const context = { kind: 'agent', provider: 'claude-code', directory: '/repo', route: 'null' }
    let binding: ManagedClaudeBindingObservation = {
      nodeId: 'agent',
      activationId: 'settled',
      runtimeSessionId: null,
      tuple,
      nodeSeen: true,
      bindingRevision: 1,
      observedRevision: 1,
    }
    let unavailable = false
    let timer!: () => void
    const cancel = vi.fn()
    const ports = {
      observeNode: vi.fn(() => {
        if (unavailable) {
          throw new Error('follow-up observation unavailable')
        }
        return {
          nodeId: 'agent',
          retired: false,
          context,
          binding,
          nodeRuntimeSessionId: binding.runtimeSessionId ?? 'fallback-shell',
        }
      }),
      isRuntimeReferenced: vi.fn((id: string) => id === binding.runtimeSessionId),
      killExactRuntime: vi.fn(async (_id: string) => {}),
      createId: () => 'replacement',
      publishCommittedActivation: vi.fn(),
      scheduleReconciliation: (callback: () => void) => {
        timer = callback
        return cancel
      },
      activateManagedClaudeRuntime: vi.fn(async (input: ActivateManagedClaudeRuntimeInput) => {
        binding = { ...binding, ...input, bindingRevision: 2, observedRevision: 2 }
        unavailable = true
        return { status: 'committed' as const, revision: 2 }
      }),
    }
    const owner = new ManagedClaudeLaunchOwner(ports)
    try {
      const originating = owner.reserve('agent')
      originating.context = context
      originating.expected = { activationId: binding.activationId, tuple }
      await owner.admit(originating, { provider: 'claude-code', cwd: '/repo', mountId: null })
      await expect(
        owner.complete(originating, { runtimeSessionId: 'candidate', tuple }),
      ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
      expect(ports.killExactRuntime).not.toHaveBeenCalled()
      unavailable = false
      const next = owner.reserve('agent')
      await owner.assertReady(next)
      expect(ports.isRuntimeReferenced).toHaveBeenCalledWith('fallback-shell')
      expect(ports.killExactRuntime).toHaveBeenCalledExactlyOnceWith('fallback-shell')
      expect(ports.publishCommittedActivation).toHaveBeenCalledExactlyOnceWith({
        nodeId: 'agent',
        activationId: 'replacement',
        revision: 2,
        effectiveState: undefined,
      })
      timer()
      await owner.assertReady(next)
      expect(ports.killExactRuntime).toHaveBeenCalledTimes(1)
      expect(ports.publishCommittedActivation).toHaveBeenCalledTimes(1)
      expect(ports.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
      expect(owner.canAdmitRuntimeWrite('agent', 'candidate')).toBe(false)
    } finally {
      owner.dispose()
    }
  })
})
