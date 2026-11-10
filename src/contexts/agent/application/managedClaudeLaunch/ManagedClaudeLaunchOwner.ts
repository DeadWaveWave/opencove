import type { ManagedClaudeLaunchPorts } from './ports'
import type { ManagedClaudeLaunchAttempt, ManagedClaudeRuntimeCandidate } from './types'
import type { ManagedClaudeLifecycleReceipt } from '../../../../shared/contracts/managedClaudeLaunch'
import type { ActivateManagedClaudeRuntimeInput } from '../../../../shared/contracts/managedClaudeResumeBinding'
import { sameManagedResumeBinding } from '../../../../shared/contracts/managedClaudeResumeBinding'
import { createAppError } from '../../../../shared/errors/appError'
import { ManagedClaudeRuntimeCleanup } from './ManagedClaudeRuntimeCleanup'
import { ManagedClaudeAttemptEffects } from './ManagedClaudeAttemptEffects'

export function rejectManagedLaunch(nodeId: string, reason: string): never {
  throw createAppError('agent.managed_launch_rejected', { details: { nodeId, reason } })
}

/** Process-local admission only. The ledger remains the durable binding authority. */
export class ManagedClaudeLaunchOwner {
  private readonly attempts = new Map<string, ManagedClaudeLaunchAttempt>()
  private readonly obligations = new Map<string, ActivateManagedClaudeRuntimeInput>()
  private readonly admitted = new Map<string, string>()
  private readonly reconciliationTimers = new Map<string, () => void>()
  private readonly effects: ManagedClaudeAttemptEffects
  private readonly activationNodePresence = new WeakMap<
    ActivateManagedClaudeRuntimeInput,
    boolean
  >()
  private readonly duplicateActivations = new WeakSet<ActivateManagedClaudeRuntimeInput>()
  private readonly activationAttempts = new WeakMap<
    ActivateManagedClaudeRuntimeInput,
    ManagedClaudeLaunchAttempt
  >()
  private readonly finalizations = new WeakMap<
    ActivateManagedClaudeRuntimeInput,
    Promise<ManagedClaudeLifecycleReceipt | null>
  >()
  private readonly runtimeCleanup: ManagedClaudeRuntimeCleanup
  private disposed = false

  constructor(private readonly ports: ManagedClaudeLaunchPorts) {
    this.runtimeCleanup = new ManagedClaudeRuntimeCleanup(
      ports,
      id =>
        this.effects.candidateHeld(id) ||
        this.effects.retirementHeld(id) ||
        [...this.obligations.values()].some(input => {
          const attempt = this.activationAttempts.get(input)
          return (
            input.runtimeSessionId === id ||
            (attempt !== undefined && this.effects.owns(attempt, id))
          )
        }),
    )
    this.effects = new ManagedClaudeAttemptEffects(this.runtimeCleanup)
  }

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
    for (;;) {
      const pending = this.obligations.get(attempt.nodeId)
      if (pending) {
        // The next obligation is known only after the current one settles.
        // oxlint-disable-next-line no-await-in-loop
        await this.reconcile(pending)
      }
      // Cleanup may yield to another activation for this node; recheck after it finishes.
      // oxlint-disable-next-line no-await-in-loop
      await this.effects.cleanupNode(attempt.nodeId)
      this.assertCurrent(attempt)
      if (!this.obligations.has(attempt.nodeId)) {
        return
      }
    }
  }

  async admit(
    attempt: ManagedClaudeLaunchAttempt,
    execution: { provider: string; cwd: string; mountId: string | null },
  ): Promise<'managed' | 'legacy'> {
    await this.assertReady(attempt)
    const observation = this.ports.observeNode(attempt.nodeId)
    const context = attempt.context
    if (
      JSON.stringify(observation.context) !== JSON.stringify(context) ||
      (context &&
        (context.kind !== 'agent' ||
          context.provider !== execution.provider ||
          (observation.binding && context.directory && context.directory !== execution.cwd)))
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
    if (!observation.binding && context?.directory && context.directory !== execution.cwd) {
      // PR2 cannot atomically adopt a changed execution directory. Keep this legacy switch.
      return 'legacy'
    }
    await this.effects.admit(attempt, async () => {
      this.assertCurrent(attempt)
      const previous = observation.nodeRuntimeSessionId
      if (previous) {
        this.effects.retainPrevious(attempt, previous)
      }
      const runtime = observation.binding?.runtimeSessionId
      if (runtime) {
        this.effects.retainPrevious(attempt, runtime)
        const release = this.effects.holdRetirement(attempt, runtime)
        try {
          const receipt = await this.complete(attempt, {
            runtimeSessionId: null,
            tuple: observation.binding!.tuple,
          })
          attempt.expected = {
            activationId: receipt.binding.activationId,
            tuple: receipt.binding.tuple,
          }
        } finally {
          release()
        }
        this.assertCurrent(attempt)
        const killed = await this.runtimeCleanup.cleanupRetained(runtime)
        if (this.runtimeCleanup.capture(runtime) !== undefined) {
          throw createAppError('agent.launch_failed', {
            debugMessage: 'Previous agent runtime could not be stopped.',
          })
        }
        if (killed) {
          this.effects.releasePrevious(attempt, runtime)
        }
        this.assertCurrent(attempt)
      }
    })
    return 'managed'
  }

  private async cleanupPrevious(attempt: ManagedClaudeLaunchAttempt): Promise<void> {
    await this.effects.cleanupPrevious(attempt)
  }

  hasEffectAdmission(attempt: ManagedClaudeLaunchAttempt): boolean {
    return this.effects.admitted(attempt)
  }

  beginLaunch(attempt: ManagedClaudeLaunchAttempt): void {
    this.effects.begin(attempt)
  }

  finishLaunch(attempt: ManagedClaudeLaunchAttempt): Promise<void> {
    return this.effects.finish(attempt)
  }

  trackCreatedRuntime(attempt: ManagedClaudeLaunchAttempt, id: string): void {
    this.effects.retainCreated(attempt, id)
    if (!this.isCurrent(attempt)) {
      void this.runtimeCleanup.cleanupRetained(id)
      this.assertCurrent(attempt)
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
    const claim = this.runtimeCleanup.capture(input.runtimeSessionId)
    try {
      observation = this.ports.observeNode(input.nodeId)
    } catch {
      return this.uncertain(input, 'unknown')
    }
    const binding = observation.binding
    if (
      binding?.activationId === input.activationId &&
      binding.runtimeSessionId === input.runtimeSessionId &&
      sameManagedResumeBinding(binding.tuple, input.tuple)
    ) {
      // The row's exact revision is attributable; a later observation is not a commit revision.
      const appCommit =
        this.activationNodePresence.get(input) === true && !this.duplicateActivations.has(input)
      return this.finalize(
        input,
        binding,
        appCommit ? binding.bindingRevision : null,
        undefined,
        claim,
      )
    }
    return this.finalize(input, null, null)
  }

  private finalize(
    input: ActivateManagedClaudeRuntimeInput,
    binding: ManagedClaudeLifecycleReceipt['binding'] | null,
    commitRevision: number | null,
    effectiveState?: unknown,
    claim?: symbol,
  ): Promise<ManagedClaudeLifecycleReceipt | null> {
    const existing = this.finalizations.get(input)
    if (existing) {
      return existing
    }
    // Install before callbacks or async cleanup can reenter. Every entry point shares the origin.
    const completion = Promise.resolve().then(async () => {
      const attempt = this.activationAttempts.get(input)!
      if (binding && this.isCurrent(attempt) && input.runtimeSessionId) {
        this.admitted.set(input.nodeId, input.runtimeSessionId)
      }
      if (binding && commitRevision !== null) {
        this.publish(input, commitRevision, effectiveState)
      }
      if (binding && input.runtimeSessionId) {
        this.runtimeCleanup.confirmReferenced(input.runtimeSessionId, claim)
      } else if (input.runtimeSessionId) {
        await this.runtimeCleanup.cleanupRetained(input.runtimeSessionId)
      }
      await this.cleanupPrevious(attempt)
      await this.effects.cleanupCreated(attempt, input.runtimeSessionId)
      return binding ? { binding, commitRevision } : null
    })
    this.finalizations.set(input, completion)
    this.releaseObligation(input)
    return completion
  }

  private releaseObligation(input: ActivateManagedClaudeRuntimeInput): void {
    if (this.obligations.get(input.nodeId) === input) {
      this.obligations.delete(input.nodeId)
      this.reconciliationTimers.get(input.nodeId)?.()
      this.reconciliationTimers.delete(input.nodeId)
    }
  }

  private scheduleReconciliation(input: ActivateManagedClaudeRuntimeInput, retry = 0): void {
    if (
      !this.ports.scheduleReconciliation ||
      this.disposed ||
      this.obligations.get(input.nodeId) !== input
    ) {
      return
    }
    this.reconciliationTimers.get(input.nodeId)?.()
    const timer = { cancel: () => {} }
    const cancel = () => timer.cancel()
    timer.cancel = this.ports.scheduleReconciliation(() => {
      if (this.reconciliationTimers.get(input.nodeId) !== cancel) {
        return
      }
      this.reconciliationTimers.delete(input.nodeId)
      if (this.disposed || this.obligations.get(input.nodeId) !== input) {
        return
      }
      void this.reconcile(input).catch(() => this.scheduleReconciliation(input, retry + 1))
    }, [250, 1000, 3000][Math.min(retry, 2)])
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

  cleanup(runtimeSessionId: string): Promise<boolean> {
    return this.runtimeCleanup.cleanup(runtimeSessionId)
  }

  pendingCleanupRuntimeIds(): readonly string[] {
    return this.runtimeCleanup.pendingRuntimeIds()
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
    this.effects.renewPrevious(attempt)
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
    this.activationAttempts.set(input, attempt)
    if (candidate.runtimeSessionId) {
      this.effects.retainCreated(attempt, candidate.runtimeSessionId)
    }
    try {
      let result = await this.activate(attempt, input)
      if (result.status === 'retryableFailure' && result.outcome === 'notCommitted') {
        this.releaseObligation(input)
        result = await this.activate(attempt, input)
      }
      if (result.status === 'retryableFailure') {
        if (result.outcome === 'unknown') {
          const receipt = await this.reconcile(input)
          if (receipt) {
            return receipt
          }
        }
        this.releaseObligation(input)
        return this.uncertain(input, 'notCommitted')
      }
      if (result.status !== 'committed' && result.status !== 'alreadyApplied') {
        this.releaseObligation(input)
        rejectManagedLaunch(attempt.nodeId, result.status)
      }
      if (result.status === 'alreadyApplied') {
        this.duplicateActivations.add(input)
      }
      let binding
      const claim = this.runtimeCleanup.capture(input.runtimeSessionId)
      try {
        binding = this.ports.observeNode(attempt.nodeId).binding
      } catch {
        return this.uncertain(input, 'unknown')
      }
      if (!binding || binding.activationId !== input.activationId) {
        this.releaseObligation(input)
        rejectManagedLaunch(attempt.nodeId, 'superseded')
      }
      return (await this.finalize(
        input,
        binding,
        result.status === 'committed' ? (result.revision ?? null) : null,
        result.effectiveState,
        claim,
      ))!
    } catch (error) {
      const unresolved = this.obligations.get(input.nodeId) === input
      if (unresolved) {
        this.scheduleReconciliation(input)
      }
      if (unresolved) {
        return this.uncertain(input, 'unknown')
      }
      await this.finalize(input, null, null)
      throw error
    }
  }

  async fail(attempt: ManagedClaudeLaunchAttempt): Promise<ManagedClaudeLifecycleReceipt | null> {
    this.assertCurrent(attempt)
    if (!this.effects.admitted(attempt)) {
      return null
    }
    if (this.obligations.has(attempt.nodeId)) {
      await this.assertReady(attempt)
    }
    await this.finishLaunch(attempt)
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
      await this.effects.cleanupCreated(attempt)
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
      void this.effects.cleanupNode(id)
    }
  }

  dispose(): void {
    this.disposed = true
    this.runtimeCleanup.dispose()
    for (const cancel of this.reconciliationTimers.values()) {
      cancel()
    }
    this.reconciliationTimers.clear()
    this.attempts.clear()
    this.admitted.clear()
  }
}
