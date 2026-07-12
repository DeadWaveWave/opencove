import type {
  TerminalRecoveryMutationFailureReason,
  TerminalRuntimeBinding,
} from '../../domain/recovery/terminalRecovery'
import type {
  TerminalRecoveryPersistencePort,
  TerminalRecoveryPresentationPort,
} from './terminalRecoveryPorts'

const DEFAULT_CHECKPOINT_DELAY_MS = 2_000
const DEFAULT_MAX_RAW_CHARS = 400_000
const DEFAULT_RETIRE_RETRY_DELAY_MS = 1_000

type RuntimeState = {
  nodeId: string
  generation: number
  binding: TerminalRuntimeBinding
  checkpointRevision: number
  rawTail: string
  rawTruncated: boolean
  dirty: boolean
  acceptingMutations: boolean
  timer: ReturnType<typeof setTimeout> | null
  retirementRetryTimer: ReturnType<typeof setTimeout> | null
  flushPromise: Promise<FlushStateResult> | null
}

export type TerminalRecoveryFlushFailure = {
  nodeId: string
  sessionId: string
  reason: TerminalRecoveryMutationFailureReason | 'snapshot_failed' | 'commit_failed'
  message?: string
}

export type TerminalRecoveryFlushResult = {
  status: 'complete' | 'degraded'
  committed: number
  failures: TerminalRecoveryFlushFailure[]
}

type FlushStateResult = {
  committed: number
  failure: TerminalRecoveryFlushFailure | null
}

export class TerminalRecoveryOwner {
  private readonly persistence: TerminalRecoveryPersistencePort
  private readonly presentation: TerminalRecoveryPresentationPort
  private readonly checkpointDelayMs: number
  private readonly maxRawChars: number
  private readonly retireRetryDelayMs: number
  private readonly now: () => string
  private readonly stateByNodeId = new Map<string, RuntimeState>()
  private readonly stateBySessionId = new Map<string, RuntimeState>()
  private disposed = false

  public constructor(input: {
    persistence: TerminalRecoveryPersistencePort
    presentation: TerminalRecoveryPresentationPort
    checkpointDelayMs?: number
    maxRawChars?: number
    retireRetryDelayMs?: number
    now?: () => string
  }) {
    this.persistence = input.persistence
    this.presentation = input.presentation
    this.checkpointDelayMs = input.checkpointDelayMs ?? DEFAULT_CHECKPOINT_DELAY_MS
    this.maxRawChars = input.maxRawChars ?? DEFAULT_MAX_RAW_CHARS
    this.retireRetryDelayMs = input.retireRetryDelayMs ?? DEFAULT_RETIRE_RETRY_DELAY_MS
    this.now = input.now ?? (() => new Date().toISOString())
  }

  public async reserve(input: { nodeId: string; generation: number }) {
    this.assertActive()
    const result = await this.persistence.reserve({ ...input, now: this.now() })
    if (result.ok && result.record.generation === input.generation) {
      const current = this.stateByNodeId.get(input.nodeId)
      if (current && current.generation < input.generation) {
        this.removeState(current)
      }
    }
    return result
  }

  public async bind(input: {
    nodeId: string
    generation: number
    binding: TerminalRuntimeBinding
    /** Start a replay rebuild without inheriting a raw tail whose overlap is unknown. */
    resetRawTail?: boolean
  }) {
    this.assertActive()
    const result = await this.persistence.bind({
      nodeId: input.nodeId,
      generation: input.generation,
      binding: input.binding,
      now: this.now(),
    })
    if (!result.ok) {
      return result
    }

    const previous = this.stateByNodeId.get(input.nodeId)
    if (previous) {
      this.removeState(previous)
    }
    const state: RuntimeState = {
      nodeId: input.nodeId,
      generation: input.generation,
      binding: input.binding,
      checkpointRevision: result.record.checkpoint?.checkpointRevision ?? 0,
      rawTail: input.resetRawTail === true ? '' : result.record.rawTail,
      rawTruncated: input.resetRawTail === true ? false : result.record.rawTruncated,
      dirty: false,
      acceptingMutations: true,
      timer: null,
      retirementRetryTimer: null,
      flushPromise: null,
    }
    this.stateByNodeId.set(input.nodeId, state)
    this.stateBySessionId.set(input.binding.sessionId, state)
    return result
  }

  public noteOutput(input: { sessionId: string; data: string }): boolean {
    if (this.disposed) {
      return false
    }
    const state = this.stateBySessionId.get(input.sessionId)
    if (!state || !state.acceptingMutations || input.data.length === 0) {
      return Boolean(state?.acceptingMutations)
    }

    const appended = `${state.rawTail}${input.data}`
    if (appended.length > this.maxRawChars) {
      state.rawTail = appended.slice(-this.maxRawChars)
      state.rawTruncated = true
    } else {
      state.rawTail = appended
    }
    this.markPresentationMutation(state)
    return true
  }

  public notePresentationMutation(input: { sessionId: string }): boolean {
    if (this.disposed) {
      return false
    }
    const state = this.stateBySessionId.get(input.sessionId)
    if (!state || !state.acceptingMutations) {
      return false
    }
    this.markPresentationMutation(state)
    return true
  }

  public async flushSession(sessionId: string): Promise<TerminalRecoveryFlushResult> {
    const state = this.stateBySessionId.get(sessionId)
    if (!state) {
      return { status: 'complete', committed: 0, failures: [] }
    }
    this.clearTimer(state)
    this.clearRetirementRetryTimer(state)
    const result = this.toPublicFlushResult([await this.flushState(state)])
    this.finishRetirementFlush(state, result)
    return result
  }

  /** Marks a newly bound session dirty and persists its first presentation snapshot immediately. */
  public async checkpointSession(sessionId: string): Promise<TerminalRecoveryFlushResult> {
    const state = this.stateBySessionId.get(sessionId)
    if (!state) {
      return { status: 'complete', committed: 0, failures: [] }
    }
    state.dirty = true
    return this.flushSession(sessionId)
  }

  public async flushAll(): Promise<TerminalRecoveryFlushResult> {
    const states = [...new Set(this.stateByNodeId.values())]
    for (const state of states) {
      this.clearTimer(state)
      this.clearRetirementRetryTimer(state)
    }
    const results = await Promise.all(states.map(state => this.flushState(state)))
    const result = this.toPublicFlushResult(results)
    states.forEach((state, index) => {
      this.finishRetirementFlush(state, this.toPublicFlushResult([results[index]]))
    })
    return result
  }

  /**
   * Establishes a mutation cutoff, drains everything accepted before it, then releases the binding.
   * A degraded drain keeps the cutoff and schedules a delayed, single-flight retry.
   */
  public async retireSession(sessionId: string): Promise<TerminalRecoveryFlushResult> {
    const state = this.stateBySessionId.get(sessionId)
    if (!state) {
      return { status: 'complete', committed: 0, failures: [] }
    }

    state.acceptingMutations = false
    this.clearTimer(state)
    this.clearRetirementRetryTimer(state)
    const result = this.toPublicFlushResult([await this.flushState(state)])
    this.finishRetirementFlush(state, result)
    return result
  }

  public forgetSession(sessionId: string): void {
    const state = this.stateBySessionId.get(sessionId)
    if (state) {
      this.removeState(state)
    }
  }

  /** Teardown only. Call and await flushAll() first when the latest output must be durable. */
  public dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const state of this.stateByNodeId.values()) {
      this.clearTimer(state)
      this.clearRetirementRetryTimer(state)
    }
    this.stateByNodeId.clear()
    this.stateBySessionId.clear()
  }

  private schedule(state: RuntimeState): void {
    if (!state.acceptingMutations || state.timer || state.flushPromise) {
      return
    }
    state.timer = setTimeout(() => {
      state.timer = null
      void this.startFlushBatch(state, 1)
    }, this.checkpointDelayMs)
  }

  private async flushState(state: RuntimeState): Promise<FlushStateResult> {
    let committed = 0
    for (;;) {
      this.clearTimer(state)
      // An explicit flush joins any scheduled one-shot batch, then keeps draining to its cutoff.
      // eslint-disable-next-line no-await-in-loop
      const batch = await this.startFlushBatch(state, Number.POSITIVE_INFINITY)
      committed += batch.committed
      if (batch.failure || !state.dirty || !this.isCurrent(state)) {
        return { committed, failure: batch.failure }
      }
    }
  }

  private startFlushBatch(state: RuntimeState, maxCommits: number): Promise<FlushStateResult> {
    if (state.flushPromise) {
      return state.flushPromise
    }
    const operation = this.runFlushLoop(state, maxCommits).finally(() => {
      if (state.flushPromise === operation) {
        state.flushPromise = null
      }
      if (state.acceptingMutations && state.dirty && this.isCurrent(state)) {
        this.schedule(state)
      }
    })
    state.flushPromise = operation
    return operation
  }

  private async runFlushLoop(state: RuntimeState, maxCommits: number): Promise<FlushStateResult> {
    let committed = 0
    while (committed < maxCommits && state.dirty && this.isCurrent(state)) {
      const boundary: {
        cutoff: { rawTail: string; rawTruncated: boolean } | null
      } = { cutoff: null }
      let snapshot
      try {
        // The presentation port reports the exact boundary it fences after any transition wait.
        // eslint-disable-next-line no-await-in-loop
        snapshot = await this.presentation.snapshotSession(state.binding.sessionId, () => {
          if (boundary.cutoff) {
            throw new Error('Terminal recovery snapshot captured its boundary more than once')
          }
          boundary.cutoff = { rawTail: state.rawTail, rawTruncated: state.rawTruncated }
          state.dirty = false
        })
        if (!boundary.cutoff) {
          throw new Error('Terminal recovery snapshot did not capture its mutation boundary')
        }
      } catch (error) {
        state.dirty = true
        return {
          committed,
          failure: this.failure(state, 'snapshot_failed', error),
        }
      }
      if (!this.isCurrent(state)) {
        break
      }

      const cutoff = boundary.cutoff
      if (!cutoff) {
        state.dirty = true
        return {
          committed,
          failure: this.failure(state, 'snapshot_failed', 'missing mutation boundary'),
        }
      }
      const checkpointRevision = state.checkpointRevision + 1
      try {
        // Later iterations use the checkpoint revision accepted by the preceding commit.
        // eslint-disable-next-line no-await-in-loop
        const result = await this.persistence.commit({
          nodeId: state.nodeId,
          generation: state.generation,
          binding: state.binding,
          checkpoint: { ...snapshot, checkpointRevision },
          rawTail: cutoff.rawTail,
          rawTruncated: cutoff.rawTruncated,
          checksum: null,
          now: this.now(),
        })
        if (!result.ok) {
          this.removeState(state)
          return { committed, failure: this.failure(state, result.reason) }
        }
        state.checkpointRevision =
          result.record.checkpoint?.checkpointRevision ?? checkpointRevision
        committed += 1
      } catch (error) {
        state.dirty = true
        return { committed, failure: this.failure(state, 'commit_failed', error) }
      }
    }
    return { committed, failure: null }
  }

  private isCurrent(state: RuntimeState): boolean {
    return (
      this.stateByNodeId.get(state.nodeId) === state &&
      this.stateBySessionId.get(state.binding.sessionId) === state
    )
  }

  private markPresentationMutation(state: RuntimeState): void {
    state.dirty = true
    this.schedule(state)
  }

  private removeState(state: RuntimeState): void {
    this.clearTimer(state)
    this.clearRetirementRetryTimer(state)
    if (this.stateByNodeId.get(state.nodeId) === state) {
      this.stateByNodeId.delete(state.nodeId)
    }
    if (this.stateBySessionId.get(state.binding.sessionId) === state) {
      this.stateBySessionId.delete(state.binding.sessionId)
    }
  }

  private clearTimer(state: RuntimeState): void {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
  }

  private finishRetirementFlush(state: RuntimeState, result: TerminalRecoveryFlushResult): void {
    if (state.acceptingMutations || !this.isCurrent(state)) {
      return
    }
    if (result.status === 'complete') {
      this.removeState(state)
      return
    }
    this.scheduleRetirementRetry(state)
  }

  private scheduleRetirementRetry(state: RuntimeState): void {
    if (
      this.disposed ||
      state.acceptingMutations ||
      state.retirementRetryTimer ||
      !this.isCurrent(state)
    ) {
      return
    }
    state.retirementRetryTimer = setTimeout(() => {
      state.retirementRetryTimer = null
      void this.retryRetirement(state)
    }, this.retireRetryDelayMs)
  }

  private async retryRetirement(state: RuntimeState): Promise<void> {
    if (this.disposed || state.acceptingMutations || !this.isCurrent(state)) {
      return
    }
    const result = this.toPublicFlushResult([await this.flushState(state)])
    this.finishRetirementFlush(state, result)
  }

  private clearRetirementRetryTimer(state: RuntimeState): void {
    if (state.retirementRetryTimer) {
      clearTimeout(state.retirementRetryTimer)
      state.retirementRetryTimer = null
    }
  }

  private toPublicFlushResult(results: FlushStateResult[]): TerminalRecoveryFlushResult {
    const failures = results.flatMap(result => (result.failure ? [result.failure] : []))
    return {
      status: failures.length > 0 ? 'degraded' : 'complete',
      committed: results.reduce((sum, result) => sum + result.committed, 0),
      failures,
    }
  }

  private failure(
    state: RuntimeState,
    reason: TerminalRecoveryFlushFailure['reason'],
    error?: unknown,
  ): TerminalRecoveryFlushFailure {
    return {
      nodeId: state.nodeId,
      sessionId: state.binding.sessionId,
      reason,
      ...(error === undefined
        ? {}
        : { message: error instanceof Error ? error.message : String(error) }),
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('TerminalRecoveryOwner is disposed')
    }
  }
}
