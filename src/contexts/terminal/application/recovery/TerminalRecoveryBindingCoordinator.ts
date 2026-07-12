import type {
  TerminalRuntimeBinding,
  TerminalRuntimeRoute,
} from '../../domain/recovery/terminalRecovery'
import { routesShareDurableRuntimeEpoch } from '../../domain/recovery/terminalRecovery'
import type { TerminalRecoveryFlushResult, TerminalRecoveryOwner } from './TerminalRecoveryOwner'
import type { TerminalRecoveryPersistencePort } from './terminalRecoveryPorts'

export type TerminalRecoveryBindingCandidate = {
  nodeId: string
  sessionId: string
  route: TerminalRuntimeRoute
  /** Keep the previous durable preview until live replay/output makes the new binding dirty. */
  checkpointOnBind?: boolean
  /** Rebuild raw fallback from replay when its overlap with the persisted tail is unknown. */
  resetRawTailOnBind?: boolean
}

export type TerminalRecoveryAlignedBinding = {
  nodeId: string
  sessionId: string
  generation: number
  runtimeEpoch: string
  changed: boolean
  initialCheckpoint: TerminalRecoveryFlushResult | null
}

export type TerminalRecoveryRemovedBinding = {
  nodeId: string
  sessionId: string
}

export type TerminalRecoveryBindingReconcileResult = {
  aligned: TerminalRecoveryAlignedBinding[]
  removed: TerminalRecoveryRemovedBinding[]
}

export type TerminalRecoveryBindingReconcileOptions = {
  /**
   * Active nodes whose route could not be observed during this reconciliation. They remain owned
   * until a later complete observation proves that they were removed.
   */
  preserveNodeIds?: readonly string[]
}

export type TerminalRecoveryBindingOwnerPort = Pick<
  TerminalRecoveryOwner,
  'reserve' | 'bind' | 'checkpointSession' | 'retireSession' | 'forgetSession'
>

export type CreateTerminalRuntimeEpoch = (input: {
  nodeId: string
  sessionId: string
  generation: number
  route: TerminalRuntimeRoute
}) => string

type ActiveBinding = {
  generation: number
  binding: TerminalRuntimeBinding
}

export class TerminalRecoveryBindingCoordinator {
  private readonly persistence: TerminalRecoveryPersistencePort
  private readonly owner: TerminalRecoveryBindingOwnerPort
  private readonly createRuntimeEpoch: CreateTerminalRuntimeEpoch
  private readonly activeByNodeId = new Map<string, ActiveBinding>()
  private reconcileTail: Promise<void> = Promise.resolve()

  public constructor(input: {
    persistence: TerminalRecoveryPersistencePort
    owner: TerminalRecoveryBindingOwnerPort
    createRuntimeEpoch?: CreateTerminalRuntimeEpoch
  }) {
    this.persistence = input.persistence
    this.owner = input.owner
    this.createRuntimeEpoch =
      input.createRuntimeEpoch ?? (({ nodeId, generation }) => `${nodeId}:${generation}`)
  }

  /**
   * Reconciles the complete current binding set. Calls are serialized, including checkpoint IO,
   * so two lifecycle observations cannot reserve the same generation concurrently.
   */
  public async reconcile(
    candidates: readonly TerminalRecoveryBindingCandidate[],
    options: TerminalRecoveryBindingReconcileOptions = {},
  ): Promise<TerminalRecoveryBindingReconcileResult> {
    const snapshot = snapshotCandidates(candidates)
    const preservedNodeIds = snapshotPreservedNodeIds(options.preserveNodeIds ?? [], snapshot)
    const operation = this.reconcileTail.then(() => this.reconcileNow(snapshot, preservedNodeIds))
    this.reconcileTail = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  /**
   * Aborts only the in-memory ownership established by an attach that never became usable.
   * Durable state is intentionally preserved so a later retry can reload the last checkpoint.
   */
  public async abortBinding(input: { nodeId: string; sessionId: string }): Promise<void> {
    const operation = this.reconcileTail.then(() => {
      const active = this.activeByNodeId.get(input.nodeId)
      if (!active || active.binding.sessionId !== input.sessionId) {
        return
      }
      this.owner.forgetSession(input.sessionId)
      if (this.activeByNodeId.get(input.nodeId) === active) {
        this.activeByNodeId.delete(input.nodeId)
      }
    })
    this.reconcileTail = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
  }

  private async reconcileNow(
    candidates: readonly TerminalRecoveryBindingCandidate[],
    preservedNodeIds: ReadonlySet<string>,
  ): Promise<TerminalRecoveryBindingReconcileResult> {
    const wantedNodeIds = new Set([
      ...candidates.map(candidate => candidate.nodeId),
      ...preservedNodeIds,
    ])
    const removals = [...this.activeByNodeId].filter(([nodeId]) => !wantedNodeIds.has(nodeId))
    const removed = await Promise.all(
      removals.map(async ([nodeId, active]): Promise<TerminalRecoveryRemovedBinding> => {
        await this.retireActiveBinding(nodeId, active)
        return { nodeId, sessionId: active.binding.sessionId }
      }),
    )

    const aligned = await Promise.all(candidates.map(candidate => this.alignCandidate(candidate)))
    return { aligned, removed }
  }

  private async alignCandidate(
    candidate: TerminalRecoveryBindingCandidate,
  ): Promise<TerminalRecoveryAlignedBinding> {
    const observedActive = this.activeByNodeId.get(candidate.nodeId)
    if (observedActive && !bindingMatchesCandidate(observedActive.binding, candidate)) {
      await this.retireActiveBinding(candidate.nodeId, observedActive)
    }

    const record = await this.persistence.read(candidate.nodeId)
    if (record?.binding && bindingMatchesCandidate(record.binding, candidate)) {
      const binding: TerminalRuntimeBinding = {
        ...record.binding,
        // A surviving remote PTY can move through a new Home Worker transport route while its
        // durable runtime epoch remains unchanged. Persist the fresh route on the same generation.
        route: candidate.route,
      }
      const active = this.activeByNodeId.get(candidate.nodeId)
      if (!active || !sameActiveBinding(active, record.generation, binding)) {
        const bindResult = await this.owner.bind({
          nodeId: candidate.nodeId,
          generation: record.generation,
          binding,
          resetRawTail: candidate.resetRawTailOnBind,
        })
        assertMutationSucceeded('reload', candidate.nodeId, bindResult)
        this.activeByNodeId.set(candidate.nodeId, {
          generation: record.generation,
          binding,
        })
      }
      const refreshedCheckpoint =
        candidate.checkpointOnBind === true
          ? await this.owner.checkpointSession(candidate.sessionId)
          : null
      return alignedResult(candidate.nodeId, record.generation, binding, false, refreshedCheckpoint)
    }

    const activeBeforeReplacement = this.activeByNodeId.get(candidate.nodeId)
    if (activeBeforeReplacement) {
      await this.retireActiveBinding(candidate.nodeId, activeBeforeReplacement)
    }

    const generation = (record?.generation ?? 0) + 1
    const binding: TerminalRuntimeBinding = {
      sessionId: candidate.sessionId,
      runtimeEpoch: this.createRuntimeEpoch({ ...candidate, generation }),
      route: candidate.route,
    }
    const reserveResult = await this.owner.reserve({ nodeId: candidate.nodeId, generation })
    assertMutationSucceeded('reserve', candidate.nodeId, reserveResult)
    const bindResult = await this.owner.bind({
      nodeId: candidate.nodeId,
      generation,
      binding,
      resetRawTail: candidate.resetRawTailOnBind,
    })
    assertMutationSucceeded('bind', candidate.nodeId, bindResult)
    this.activeByNodeId.set(candidate.nodeId, { generation, binding })
    const initialCheckpoint =
      candidate.checkpointOnBind === false
        ? null
        : await this.owner.checkpointSession(candidate.sessionId)
    return alignedResult(candidate.nodeId, generation, binding, true, initialCheckpoint)
  }

  private async retireActiveBinding(nodeId: string, active: ActiveBinding): Promise<void> {
    const flush = await this.owner.retireSession(active.binding.sessionId)
    if (flush.status === 'degraded') {
      const reasons = flush.failures.map(failure => failure.reason).join(', ') || 'unknown'
      throw new Error(`Terminal recovery retire failed for ${nodeId}: ${reasons}`)
    }
    if (this.activeByNodeId.get(nodeId) === active) {
      this.activeByNodeId.delete(nodeId)
    }
  }
}

function snapshotCandidates(
  candidates: readonly TerminalRecoveryBindingCandidate[],
): TerminalRecoveryBindingCandidate[] {
  const nodeIds = new Set<string>()
  const sessionIds = new Set<string>()
  return candidates.map(candidate => {
    if (nodeIds.has(candidate.nodeId)) {
      throw new Error(`Duplicate terminal recovery nodeId: ${candidate.nodeId}`)
    }
    if (sessionIds.has(candidate.sessionId)) {
      throw new Error(`Duplicate terminal recovery sessionId: ${candidate.sessionId}`)
    }
    nodeIds.add(candidate.nodeId)
    sessionIds.add(candidate.sessionId)
    return { ...candidate, route: { ...candidate.route } }
  })
}

function snapshotPreservedNodeIds(
  preservedNodeIds: readonly string[],
  candidates: readonly TerminalRecoveryBindingCandidate[],
): ReadonlySet<string> {
  const candidateNodeIds = new Set(candidates.map(candidate => candidate.nodeId))
  const snapshot = new Set<string>()
  for (const nodeId of preservedNodeIds) {
    if (typeof nodeId !== 'string' || nodeId.length === 0 || candidateNodeIds.has(nodeId)) {
      continue
    }
    snapshot.add(nodeId)
  }
  return snapshot
}

function bindingMatchesCandidate(
  binding: TerminalRuntimeBinding,
  candidate: TerminalRecoveryBindingCandidate,
): boolean {
  return (
    binding.sessionId === candidate.sessionId &&
    routesShareDurableRuntimeEpoch(binding.route, candidate.route)
  )
}

function sameActiveBinding(
  active: ActiveBinding,
  generation: number,
  binding: TerminalRuntimeBinding,
): boolean {
  return (
    active.generation === generation &&
    active.binding.sessionId === binding.sessionId &&
    active.binding.runtimeEpoch === binding.runtimeEpoch &&
    sameRoute(active.binding.route, binding.route)
  )
}

function sameRoute(left: TerminalRuntimeRoute, right: TerminalRuntimeRoute): boolean {
  if (left.kind === 'local' && right.kind === 'local') {
    return left.workerInstanceId === right.workerInstanceId
  }
  if (left.kind === 'remote' && right.kind === 'remote') {
    return (
      left.homeWorkerInstanceId === right.homeWorkerInstanceId &&
      left.endpointId === right.endpointId &&
      left.remoteSessionId === right.remoteSessionId &&
      left.targetWorkerInstanceId === right.targetWorkerInstanceId
    )
  }
  return false
}

function alignedResult(
  nodeId: string,
  generation: number,
  binding: TerminalRuntimeBinding,
  changed: boolean,
  initialCheckpoint: TerminalRecoveryFlushResult | null,
): TerminalRecoveryAlignedBinding {
  return {
    nodeId,
    sessionId: binding.sessionId,
    generation,
    runtimeEpoch: binding.runtimeEpoch,
    changed,
    initialCheckpoint,
  }
}

function assertMutationSucceeded(
  operation: string,
  nodeId: string,
  result: Awaited<ReturnType<TerminalRecoveryBindingOwnerPort['bind']>>,
): asserts result is Extract<typeof result, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Terminal recovery ${operation} failed for ${nodeId}: ${result.reason}`)
  }
}
