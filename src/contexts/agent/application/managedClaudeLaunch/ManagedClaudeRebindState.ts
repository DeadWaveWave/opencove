import { resolveQualifiedClaudeClearResumeBindingUpdate } from '../../domain/agentResumeBinding'
import type { ManagedClaudeLaunchPorts } from './ports'
import type { ManagedClaudeBindingObservation } from '../../../../shared/contracts/managedClaudeLaunch'
import {
  sameManagedResumeBinding,
  type CommitManagedClaudeRebindInput,
} from '../../../../shared/contracts/managedClaudeResumeBinding'
import type {
  ClaudeQualificationIdentity,
  ManagedClaudeBindingAdmission,
  ManagedClaudeQualificationTicket,
  ManagedClaudeDrainResult,
} from './qualification'

type Target = { identity: ClaudeQualificationIdentity; mutationId: string }
type Invocation = {
  nodeId: string
  runtimeSessionId: string
  credential: object
  current: () => boolean
  open: boolean
  valid: boolean
  failed?: boolean
  highest: number
  committed: ManagedClaudeBindingObservation
  tickets: Set<AbortController>
  target?: Target
  unresolved?: { input: CommitManagedClaudeRebindInput; nodeSeen: boolean }
  busy?: Promise<void>
  cancelRetry?: () => void
}

/** Bookkeeping owned exclusively by ManagedClaudeLaunchOwner; no subscriptions or durable state. */
export class ManagedClaudeRebindState {
  private readonly invocations = new Map<ManagedClaudeBindingAdmission, Invocation>()
  private closed = false
  constructor(
    private readonly ports: Pick<
      ManagedClaudeLaunchPorts,
      | 'observeNode'
      | 'createId'
      | 'commitManagedClaudeRebind'
      | 'scheduleReconciliation'
      | 'projectCommittedBinding'
    >,
    private readonly nodeForRuntime: (runtime: string) => string | undefined,
    private readonly canSettle: (node: string, runtime: string) => boolean,
    private readonly isActivationPending: (runtime: string) => boolean = () => false,
  ) {}
  admissionStatus(runtime: string): 'ready' | 'pending' | 'refused' {
    if (this.closed) {
      return 'refused'
    }
    const node = this.nodeForRuntime(runtime)
    if (node && this.canSettle(node, runtime)) {
      return 'ready'
    }
    return this.isActivationPending(runtime) ? 'pending' : 'refused'
  }
  openInvocation(
    runtimeSessionId: string,
    credential: object,
    current: () => boolean,
  ): ManagedClaudeBindingAdmission | null {
    if (this.closed || !current() || !this.ports.commitManagedClaudeRebind) {
      return null
    }
    for (const [admission, state] of this.invocations) {
      if (state.credential === credential) {
        return state.open && state.valid ? admission : null
      }
    }
    if (
      [...this.invocations.values()].some(
        state => state.valid && state.runtimeSessionId === runtimeSessionId,
      )
    ) {
      return null
    }
    const nodeId = this.nodeForRuntime(runtimeSessionId)
    if (!nodeId || !this.canSettle(nodeId, runtimeSessionId)) {
      return null
    }
    const observation = this.ports.observeNode(nodeId)
    if (observation.retired || observation.binding?.runtimeSessionId !== runtimeSessionId) {
      return null
    }
    const admission = Object.freeze({ identity: Symbol('managed Claude invocation') })
    this.invocations.set(admission, {
      nodeId,
      runtimeSessionId,
      credential,
      current,
      open: true,
      valid: true,
      highest: 0,
      committed: observation.binding,
      tickets: new Set(),
    })
    return admission
  }
  beginQualification(
    admission: ManagedClaudeBindingAdmission,
    identity: ClaudeQualificationIdentity,
  ): ManagedClaudeQualificationTicket | null {
    const state = this.invocations.get(admission)
    if (
      !state?.valid ||
      !state.open ||
      this.closed ||
      !state.current() ||
      state.tickets.size >= 8 ||
      !this.canSettle(state.nodeId, state.runtimeSessionId)
    ) {
      return null
    }
    if (!identity.promptId || !identity.resumeSessionId || identity.ordinal < 1) {
      return null
    }
    const bound = Object.freeze({ ...identity }),
      controller = new AbortController()
    state.tickets.add(controller)
    const release = () => state.tickets.delete(controller)
    // oxlint-disable-next-line no-this-alias -- ticket receiver and lifecycle owner are distinct authorities.
    const owner = this
    const ticket: ManagedClaudeQualificationTicket = Object.freeze({
      signal: controller.signal,
      discard() {
        if (this !== ticket) {
          return
        }
        release()
        controller.abort()
      },
      async submit(proof) {
        if (this !== ticket) {
          return { status: 'rejected' as const }
        }
        if (!state.valid || !state.tickets.has(controller)) {
          return { status: 'cancelled' as const }
        }
        release()
        if (
          !proof.evidenceId ||
          Object.keys(bound).some(
            key =>
              proof[key as keyof ClaudeQualificationIdentity] !==
              bound[key as keyof ClaudeQualificationIdentity],
          )
        ) {
          return { status: 'rejected' as const }
        }
        if (bound.ordinal < state.highest) {
          return { status: 'superseded' as const }
        }
        state.highest = bound.ordinal
        state.target = { identity: bound, mutationId: owner.ports.createId() }
        void owner.pump(state)
        return { status: 'accepted' as const }
      },
    })
    return ticket
  }
  hasPending(nodeId: string): boolean {
    return [...this.invocations.values()].some(
      state =>
        (state.valid || state.failed) &&
        state.nodeId === nodeId &&
        Boolean(
          state.failed || state.tickets.size || state.target || state.unresolved || state.busy,
        ),
    )
  }
  closeInvocation(admission: ManagedClaudeBindingAdmission): void {
    const state = this.invocations.get(admission)
    if (state) {
      state.open = false
    }
  }
  cancelNode(nodeId: string): void {
    for (const [admission, state] of this.invocations) {
      if (state.nodeId === nodeId) {
        this.cancel(state)
        this.invocations.delete(admission)
      }
    }
  }
  private cancel(state: Invocation): void {
    state.valid = false
    state.open = false
    state.cancelRetry?.()
    state.tickets.forEach(controller => controller.abort())
    state.tickets.clear()
    state.target = undefined
  }
  private observe(state: Invocation): ManagedClaudeBindingObservation | null {
    if (!state.valid || !this.canSettle(state.nodeId, state.runtimeSessionId)) {
      this.cancel(state)
      return null
    }
    const observation = this.ports.observeNode(state.nodeId)
    if (observation.retired || observation.binding?.runtimeSessionId !== state.runtimeSessionId) {
      this.cancel(state)
      return null
    }
    return observation.binding
  }
  private pump(state: Invocation): Promise<void> {
    if (state.busy) {
      return state.busy.then(() => this.pump(state))
    }
    if (!state.valid || (!state.target && !state.unresolved)) {
      return Promise.resolve()
    }
    const work = this.run(state)
      .catch(() => {
        /* Unknown/read unavailable stays an obligation. */
      })
      .finally(() => {
        state.busy = undefined
        if (state.valid && (state.target || state.unresolved)) {
          state.cancelRetry?.()
          state.cancelRetry = this.ports.scheduleReconciliation?.(() => {
            state.cancelRetry = undefined
            void this.pump(state)
          }, 250)
        }
      })
    state.busy = work
    return work
  }
  private project(
    state: Invocation,
    binding: ManagedClaudeBindingObservation,
    commitRevision: number | null,
  ): void {
    state.committed = binding
    try {
      this.ports.projectCommittedBinding?.({ binding, commitRevision })
    } catch {
      /* Projection cannot undo a commit. */
    }
  }
  private async run(state: Invocation): Promise<void> {
    let binding = this.observe(state)
    if (!binding) {
      return
    }
    if (state.unresolved) {
      const { input, nodeSeen } = state.unresolved
      if (
        binding.activationId === input.activationId &&
        sameManagedResumeBinding(binding.tuple, input.next)
      ) {
        this.project(state, binding, nodeSeen ? binding.bindingRevision : null)
        if (state.target?.mutationId === input.activationId) {
          state.target = undefined
        }
      } else if (
        binding.activationId !== state.committed.activationId ||
        !sameManagedResumeBinding(binding.tuple, input.expected)
      ) {
        state.failed = true
        this.cancel(state)
        return
      }
      state.unresolved = undefined
    }
    if (!state.target || !state.valid) {
      return
    }
    if (
      binding.activationId !== state.committed.activationId ||
      !sameManagedResumeBinding(binding.tuple, state.committed.tuple)
    ) {
      state.failed = true
      this.cancel(state)
      return
    }
    const target = state.target
    const next = resolveQualifiedClaudeClearResumeBindingUpdate(
      { provider: 'claude-code', ...binding.tuple },
      target.identity,
    )
    if (!next) {
      state.target = undefined
      return
    }
    const input: CommitManagedClaudeRebindInput = {
      nodeId: state.nodeId,
      runtimeSessionId: state.runtimeSessionId,
      activationId: target.mutationId,
      expected: { ...binding.tuple },
      next,
    }
    // The synchronous guard above and local transaction invocation have no async gap.
    state.unresolved = { input, nodeSeen: binding.nodeSeen }
    const result = await this.ports.commitManagedClaudeRebind!(input)
    if (!state.valid) {
      return
    }
    if (result.status === 'retryableFailure' && result.outcome === 'unknown') {
      return
    }
    if (result.status === 'superseded' || result.status === 'nodeGone') {
      this.cancel(state)
      return
    }
    binding = this.observe(state)
    if (!binding) {
      return
    }
    if (
      binding.activationId === input.activationId &&
      sameManagedResumeBinding(binding.tuple, input.next)
    ) {
      this.project(state, binding, result.status === 'committed' ? (result.revision ?? null) : null)
      if (state.target === target) {
        state.target = undefined
      }
    } else if (
      binding.activationId !== state.committed.activationId ||
      !sameManagedResumeBinding(binding.tuple, input.expected)
    ) {
      state.failed = true
      this.cancel(state)
    }
    state.unresolved = undefined
  }
  async drain(options: {
    deadlineAt: number
    nodeId?: string
    credential?: object
  }): Promise<ManagedClaudeDrainResult> {
    const states = [...this.invocations.values()].filter(
      state =>
        (state.valid || state.failed) &&
        (!options.nodeId || state.nodeId === options.nodeId) &&
        (!options.credential || state.credential === options.credential),
    )
    states.forEach(state => {
      state.open = false
    })
    const pending = () =>
      states.filter(
        state =>
          state.valid && (state.tickets.size || state.target || state.unresolved || state.busy),
      )
    while (pending().length && performance.now() < options.deadlineAt) {
      states.forEach(state => {
        if (!state.busy) {
          void this.pump(state)
        }
      })
      // Bound the wait even when a filesystem/store promise never settles.
      // oxlint-disable-next-line no-await-in-loop
      await new Promise(resolve =>
        setTimeout(resolve, Math.min(10, Math.max(0, options.deadlineAt - performance.now()))),
      )
    }
    const remaining = [...new Set([...pending(), ...states.filter(state => state.failed)])]
    if (!remaining.length) {
      return { status: 'drained' }
    }
    remaining.forEach(state => {
      state.failed = true
      this.cancel(state)
    })
    return {
      status: 'degraded',
      pendingNodeIds: [...new Set(remaining.map(state => state.nodeId))],
    }
  }
  dispose(): void {
    this.closed = true
    this.invocations.forEach(state => this.cancel(state))
    this.invocations.clear()
  }
}
