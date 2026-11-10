import type { ManagedClaudeLaunchPorts } from './ports'
import type { ManagedClaudeLaunchAttempt, ManagedClaudeRuntimeCandidate } from './types'
import type { ManagedClaudeLifecycleReceipt } from '../../../../shared/contracts/managedClaudeLaunch'
import type { ActivateManagedClaudeRuntimeInput } from '../../../../shared/contracts/managedClaudeResumeBinding'
import { sameManagedResumeBinding } from '../../../../shared/contracts/managedClaudeResumeBinding'
import { createAppError } from '../../../../shared/errors/appError'

export function rejectManagedLaunch(nodeId: string, reason: string): never {
  throw createAppError('agent.managed_launch_rejected', { details: { nodeId, reason } })
}

/** Process-local admission only. The ledger remains the durable binding authority. */
export class ManagedClaudeLaunchOwner {
  private readonly attempts = new Map<string, ManagedClaudeLaunchAttempt>()
  private readonly obligations = new Map<string, ActivateManagedClaudeRuntimeInput>()
  private readonly admitted = new Map<string, string>()
  private readonly reconciliationTimers = new Map<string, () => void>()
  private readonly effectAdmissions = new WeakSet<ManagedClaudeLaunchAttempt>()
  private readonly activationNodePresence = new WeakMap<
    ActivateManagedClaudeRuntimeInput,
    boolean
  >()
  private readonly duplicateActivations = new WeakSet<ActivateManagedClaudeRuntimeInput>()
  private disposed = false

  constructor(private readonly ports: ManagedClaudeLaunchPorts) {}

  reserve(nodeId: string): ManagedClaudeLaunchAttempt {
    const attempt = { nodeId, token: Symbol(nodeId) }
    if (!this.disposed) {
      this.attempts.set(nodeId, attempt)
      this.admitted.delete(nodeId)
    }
    return attempt
  }

  isCurrent(attempt: ManagedClaudeLaunchAttempt): boolean {
    return !this.disposed && this.attempts.get(attempt.nodeId) === attempt
  }

  assertCurrent(attempt: ManagedClaudeLaunchAttempt): void {
    if (!this.isCurrent(attempt)) {
      rejectManagedLaunch(attempt.nodeId, 'superseded')
    }
  }

  async assertReady(attempt: ManagedClaudeLaunchAttempt): Promise<void> {
    const pending = this.obligations.get(attempt.nodeId)
    if (pending) {
      await this.reconcile(pending)
    }
    this.assertCurrent(attempt)
  }

  async admit(
    attempt: ManagedClaudeLaunchAttempt,
    execution: { provider: string; cwd: string; mountId: string | null },
  ): Promise<void> {
    await this.assertReady(attempt)
    const observation = this.ports.observeNode(attempt.nodeId)
    const context = attempt.context
    if (
      JSON.stringify(observation.context) !== JSON.stringify(context) ||
      (context &&
        (context.kind !== 'agent' ||
          context.provider !== execution.provider ||
          (context.directory && context.directory !== execution.cwd)))
    ) {
      rejectManagedLaunch(attempt.nodeId, 'identityConflict')
    }
    const route = context
      ? (JSON.parse(context.route) as { endpointId: string; mountId: string | null } | null)
      : null
    if (route && (route.endpointId !== 'local' || route.mountId !== execution.mountId)) {
      rejectManagedLaunch(attempt.nodeId, 'identityConflict')
    }
    if (
      attempt.expected &&
      (attempt.expected.activationId !== (observation.binding?.activationId ?? null) ||
        !sameManagedResumeBinding(
          attempt.expected.tuple,
          observation.binding?.tuple ?? { resumeSessionId: null, resumeSessionIdVerified: false },
        ))
    ) {
      rejectManagedLaunch(attempt.nodeId, 'conflict')
    }
    if (!this.effectAdmissions.has(attempt)) {
      this.effectAdmissions.add(attempt)
      const runtime = observation.binding?.runtimeSessionId
      if (runtime) {
        this.assertCurrent(attempt)
        await this.ports.killExactRuntime(runtime)
        this.assertCurrent(attempt)
      }
    }
  }

  canAdmitRuntimeWrite(nodeId: string, runtimeSessionId: string): boolean {
    return (
      !this.disposed &&
      !this.obligations.has(nodeId) &&
      this.admitted.get(nodeId) === runtimeSessionId
    )
  }

  private uncertain(
    input: ActivateManagedClaudeRuntimeInput,
    outcome: 'unknown' | 'notCommitted',
  ): never {
    throw createAppError('agent.managed_launch_commit_failed', {
      details: { nodeId: input.nodeId, activationId: input.activationId, outcome },
    })
  }

  private async reconcile(
    input: ActivateManagedClaudeRuntimeInput,
  ): Promise<ManagedClaudeLifecycleReceipt | null> {
    let observation
    try {
      observation = this.ports.observeNode(input.nodeId)
    } catch {
      return this.uncertain(input, 'unknown')
    }
    const binding = observation.binding
    this.obligations.delete(input.nodeId)
    if (
      binding?.activationId === input.activationId &&
      binding.runtimeSessionId === input.runtimeSessionId &&
      sameManagedResumeBinding(binding.tuple, input.tuple)
    ) {
      // The row's exact revision is attributable; a later observation is not a commit revision.
      const appCommit =
        this.activationNodePresence.get(input) === true && !this.duplicateActivations.has(input)
      if (appCommit) {
        this.publish(input, binding.bindingRevision, undefined)
      }
      return { binding, commitRevision: appCommit ? binding.bindingRevision : null }
    }
    return null
  }

  private scheduleReconciliation(
    attempt: ManagedClaudeLaunchAttempt,
    input: ActivateManagedClaudeRuntimeInput,
    retry = 0,
  ): void {
    if (
      !this.ports.scheduleReconciliation ||
      this.disposed ||
      retry >= 3 ||
      this.obligations.get(input.nodeId) !== input
    ) {
      return
    }
    this.reconciliationTimers.get(input.nodeId)?.()
    const cancel = this.ports.scheduleReconciliation(() => {
      this.reconciliationTimers.delete(input.nodeId)
      if (this.disposed || this.obligations.get(input.nodeId) !== input) {
        return
      }
      void this.reconcile(input)
        .then(receipt => {
          if (receipt && this.isCurrent(attempt) && input.runtimeSessionId) {
            this.admitted.set(input.nodeId, input.runtimeSessionId)
          }
          if (!receipt && input.runtimeSessionId) {
            void this.cleanup(input.runtimeSessionId)
          }
        })
        .catch(() => this.scheduleReconciliation(attempt, input, retry + 1))
    }, [250, 1000, 3000][retry])
    this.reconciliationTimers.set(input.nodeId, cancel)
  }

  private publish(
    input: ActivateManagedClaudeRuntimeInput,
    revision: number,
    effectiveState: unknown,
  ): void {
    try {
      this.ports.publishCommittedActivation({
        nodeId: input.nodeId,
        activationId: input.activationId,
        revision,
        effectiveState,
      })
    } catch {
      /* Committed writes cannot be compensated for notification failure. */
    }
  }

  async cleanup(runtimeSessionId: string): Promise<boolean> {
    if ([...this.obligations.values()].some(input => input.runtimeSessionId === runtimeSessionId)) {
      return false
    }
    try {
      if (!this.ports.isRuntimeReferenced(runtimeSessionId)) {
        await this.ports.killExactRuntime(runtimeSessionId)
        return true
      }
    } catch {
      /* Unavailable proof is never permission to kill. */
    }
    return false
  }

  private activate(attempt: ManagedClaudeLaunchAttempt, input: ActivateManagedClaudeRuntimeInput) {
    this.assertCurrent(attempt)
    const observation = this.ports.observeNode(attempt.nodeId)
    if (observation.retired) {
      rejectManagedLaunch(attempt.nodeId, 'nodeGone')
    }
    if (
      attempt.context !== undefined &&
      JSON.stringify(observation.context) !== JSON.stringify(attempt.context)
    ) {
      rejectManagedLaunch(attempt.nodeId, 'identityConflict')
    }
    // No await between the final guard and synchronous local transaction invocation.
    this.assertCurrent(attempt)
    this.activationNodePresence.set(input, observation.context !== null)
    this.obligations.set(input.nodeId, input)
    return this.ports.activateManagedClaudeRuntime(input)
  }

  async complete(
    attempt: ManagedClaudeLaunchAttempt,
    candidate: ManagedClaudeRuntimeCandidate,
  ): Promise<ManagedClaudeLifecycleReceipt> {
    const input: ActivateManagedClaudeRuntimeInput = {
      nodeId: attempt.nodeId,
      activationId: this.ports.createId(),
      ...candidate,
      expected: attempt.expected,
    }
    try {
      let result = await this.activate(attempt, input)
      if (result.status === 'retryableFailure' && result.outcome === 'notCommitted') {
        this.obligations.delete(input.nodeId)
        result = await this.activate(attempt, input)
      }
      if (result.status === 'retryableFailure') {
        if (result.outcome === 'unknown') {
          this.obligations.set(input.nodeId, input)
          const receipt = await this.reconcile(input)
          if (receipt) {
            if (this.isCurrent(attempt) && candidate.runtimeSessionId) {
              this.admitted.set(attempt.nodeId, candidate.runtimeSessionId)
            }
            return receipt
          }
        }
        this.obligations.delete(input.nodeId)
        return this.uncertain(input, 'notCommitted')
      }
      if (result.status !== 'committed' && result.status !== 'alreadyApplied') {
        this.obligations.delete(input.nodeId)
        rejectManagedLaunch(attempt.nodeId, result.status)
      }
      if (result.status === 'alreadyApplied') {
        this.duplicateActivations.add(input)
      }
      this.obligations.set(input.nodeId, input)
      let binding
      try {
        binding = this.ports.observeNode(attempt.nodeId).binding
      } catch {
        return this.uncertain(input, 'unknown')
      }
      this.obligations.delete(input.nodeId)
      if (!binding || binding.activationId !== input.activationId) {
        rejectManagedLaunch(attempt.nodeId, 'superseded')
      }
      if (this.isCurrent(attempt) && candidate.runtimeSessionId) {
        this.admitted.set(attempt.nodeId, candidate.runtimeSessionId)
      }
      if (result.status === 'committed' && result.revision !== undefined) {
        this.publish(input, result.revision, result.effectiveState)
      }
      return {
        binding,
        commitRevision: result.status === 'committed' ? (result.revision ?? null) : null,
      }
    } catch (error) {
      const unresolved = this.obligations.get(input.nodeId) === input
      if (unresolved) {
        this.scheduleReconciliation(attempt, input)
      }
      if (candidate.runtimeSessionId) {
        await this.cleanup(candidate.runtimeSessionId)
      }
      if (unresolved) {
        return this.uncertain(input, 'unknown')
      }
      throw error
    }
  }

  async fail(attempt: ManagedClaudeLaunchAttempt): Promise<ManagedClaudeLifecycleReceipt | null> {
    await this.assertReady(attempt)
    const observation = this.ports.observeNode(attempt.nodeId)
    if (!observation.binding) {
      return null
    }
    if (
      attempt.expected &&
      (attempt.expected.activationId !== observation.binding.activationId ||
        !sameManagedResumeBinding(attempt.expected.tuple, observation.binding.tuple))
    ) {
      rejectManagedLaunch(attempt.nodeId, 'superseded')
    }
    if (observation.binding.runtimeSessionId === null) {
      return { binding: observation.binding, commitRevision: null }
    }
    attempt.expected = {
      activationId: observation.binding.activationId,
      tuple: observation.binding.tuple,
    }
    const receipt = await this.complete(attempt, {
      runtimeSessionId: null,
      tuple: observation.binding.tuple,
    })
    attempt.expected = { activationId: receipt.binding.activationId, tuple: receipt.binding.tuple }
    return receipt
  }

  noteNodesDeleted(nodeIds: readonly string[]): void {
    for (const id of nodeIds) {
      this.attempts.delete(id)
      this.admitted.delete(id)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const cancel of this.reconciliationTimers.values()) {
      cancel()
    }
    this.reconciliationTimers.clear()
    this.attempts.clear()
    this.admitted.clear()
  }
}
