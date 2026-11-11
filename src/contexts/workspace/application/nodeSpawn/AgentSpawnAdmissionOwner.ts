import { createAppError } from '../../../../shared/errors/appError'
import { spawnForbiddenDetails } from '../../../../shared/errors/agentSpawnError'
import type { NodeLineageRecord } from '../../domain/nodeLineage'
import { assertGrantRuntimeSpawnAllowed } from '../../domain/agentSpawnPolicy'
import { deriveNodeLineage } from '../../domain/nodeLineage'
import type { NodeControlAppStateStore } from '../nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../nodeControl/nodeCreationTarget'
import type { AgentSpawnRuntimePort } from './AgentSpawnRuntimePort'

export interface GrantCreationAuthority {
  grantId: string
  nodeId: string | null
  sessionId: string
  delegated?: boolean
}
export interface AgentSpawnPermit {
  readonly opaque: unique symbol
}
type Admission = {
  authority: GrantCreationAuthority
  nodeId: string
  kind: 'agent' | 'terminal'
  target: ResolvedNodeCreationTarget
  assertActive(): void
}
function forbidden(
  reason: Parameters<typeof spawnForbiddenDetails>[0],
  operationId = 'node.create',
): never {
  throw createAppError('common.forbidden', { details: spawnForbiddenDetails(reason, operationId) })
}
export function spawnAccountingUnavailable(): never {
  throw createAppError('common.unavailable', {
    details: { reason: 'spawn_accounting_unavailable', retryable: false },
    debugMessage:
      'OpenCove could not verify this agent tree’s running runtimes. Ask the user to check the affected runtimes and start a new agent on the canvas for further delegation.',
  })
}
export function spawnTargetKey(target: ResolvedNodeCreationTarget): string {
  return JSON.stringify([
    target.workspace.id,
    target.space?.id,
    target.mount?.mountId,
    target.endpoint.endpointId,
    target.workingDirectory,
  ])
}

/** Caller holds the existing node mutation queue through runCreation settlement. */
export class AgentSpawnAdmissionOwner {
  private readonly pending = new Set<string>()
  private readonly captured = new Map<string, NodeLineageRecord>()
  private readonly permits = new Map<AgentSpawnPermit, Admission & { used: boolean }>()
  private readonly historicalFences = new Set<string>()
  private initialized = false
  public constructor(private readonly runtime: AgentSpawnRuntimePort) {}

  public authorize(
    permit: AgentSpawnPermit | undefined,
    authority: GrantCreationAuthority,
    operationId: string,
    childId?: string | null,
  ): void {
    const entry = permit && this.permits.get(permit)
    if (
      !entry ||
      entry.used ||
      entry.authority.grantId !== authority.grantId ||
      entry.authority.sessionId !== authority.sessionId ||
      childId !== entry.nodeId ||
      (entry.kind === 'agent'
        ? !['session.launchAgent', 'session.launchAgentInMount'].includes(operationId)
        : !['pty.spawn', 'pty.spawnInMount'].includes(operationId))
    ) {
      forbidden('node_create_required', operationId)
    }
    entry.assertActive()
  }
  public sessionsForNode(nodeId: string): string[] {
    return this.runtime
      .snapshot()
      .bindings.filter(b => b.nodeId === nodeId && b.state === 'running')
      .map(b => b.sessionId)
  }
  public consume(permit: AgentSpawnPermit): void {
    const entry = this.permits.get(permit)
    if (!entry || entry.used) {
      forbidden('node_create_required')
    }
    entry.assertActive()
    entry.used = true
  }
  public assertExecution(permit: AgentSpawnPermit, execution: { cwd: string }): void {
    const entry = this.permits.get(permit)
    if (!entry || execution.cwd !== entry.target.workingDirectory) {
      forbidden('remote_spawning_unsupported')
    }
  }
  public assertTarget(permit: AgentSpawnPermit, target: ResolvedNodeCreationTarget): void {
    const entry = this.permits.get(permit)
    if (
      !entry ||
      target.endpoint.kind === 'remote_worker' ||
      spawnTargetKey(entry.target) !== spawnTargetKey(target)
    ) {
      forbidden('remote_spawning_unsupported')
    }
  }

  public async runCreation<T>(
    store: NodeControlAppStateStore,
    input: Admission,
    create: (permit: AgentSpawnPermit, lineage: NodeLineageRecord) => Promise<T>,
  ): Promise<T> {
    if (!input.authority.nodeId) {
      forbidden('caller_node_required')
    }
    if (input.authority.delegated || input.target.endpoint.kind === 'remote_worker') {
      forbidden('remote_spawning_unsupported')
    }
    if (!store.nodeLineage || !store.commitCreatedNodeState) {
      throw createAppError('persistence.unavailable')
    }
    // Retry only observation. No launch or persistence mutation occurs in this loop.
    /* eslint-disable no-await-in-loop */
    for (;;) {
      input.assertActive()
      const revision = await store.readAppStateRevision()
      const state = await store.readAppState()
      const nodes = state?.workspaces.flatMap(w => w.nodes) ?? []
      const caller = nodes.find(n => n.id === input.authority.nodeId)
      if (
        !caller ||
        !['agent', 'terminal'].includes(caller.kind) ||
        caller.sessionId !== input.authority.sessionId
      ) {
        forbidden('caller_session_mismatch')
      }
      const census = this.runtime.snapshot()
      const ids = [
        ...new Set([
          input.authority.nodeId!,
          ...census.bindings.map(b => b.nodeId),
          ...nodes.map(n => n.id),
        ]),
      ]
      const orphanRoots = new Set<string>()
      let rows: ReadonlyMap<string, NodeLineageRecord>
      try {
        rows = await store.nodeLineage.readMany(ids)
        if (!this.initialized) {
          // An orphan's endpoint/session is not durable. Never assume it was local or exited.
          const history = await store.nodeLineage.readAll?.()
          if (!history) {
            spawnAccountingUnavailable()
          }
          for (const row of history.values()) {
            if (!nodes.some(n => n.id === row.nodeId)) {
              orphanRoots.add(row.rootNodeId)
            }
          }
        }
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'common.unavailable'
        ) {
          throw error
        }
        throw createAppError('persistence.unavailable')
      }
      if (
        revision !== (await store.readAppStateRevision()) ||
        !this.runtime.isCurrent(census.revision)
      ) {
        continue
      }
      if (store.isAppStateRevisionCurrent && !store.isAppStateRevisionCurrent(revision)) {
        continue
      }
      for (const root of orphanRoots) {
        this.historicalFences.add(root)
      }
      this.initialized = true
      input.assertActive()
      const lineage = deriveNodeLineage({
        nodeId: input.nodeId,
        callerNodeId: caller.id,
        parent: this.captured.get(caller.id) ?? rows.get(caller.id) ?? null,
      })
      if (this.historicalFences.has(lineage.rootNodeId)) {
        spawnAccountingUnavailable()
      }
      const occupied = new Set<string>()
      const bindings = [
        ...census.bindings,
        ...nodes
          .filter(
            n =>
              n.sessionId &&
              ['agent', 'terminal'].includes(n.kind) &&
              this.runtime.isSessionActive?.(n.sessionId),
          )
          .map(n => ({
            nodeId: n.id,
            sessionId: n.sessionId!,
            runtimeOwner: 'local' as const,
            state: 'running' as const,
          })),
      ]
      for (const binding of bindings) {
        const record = this.captured.get(binding.nodeId) ?? rows.get(binding.nodeId)
        if (record?.rootNodeId !== lineage.rootNodeId) {
          continue
        }
        if (binding.runtimeOwner !== 'local' || binding.state === 'unknown') {
          spawnAccountingUnavailable()
        }
        occupied.add(binding.nodeId)
      }
      // Saved remote bindings have no trustworthy completion census after disconnect/restart.
      for (const node of nodes) {
        if (
          node.workerBinding?.endpointId &&
          node.workerBinding.endpointId !== 'local' &&
          rows.get(node.id)?.rootNodeId === lineage.rootNodeId
        ) {
          spawnAccountingUnavailable()
        }
      }
      for (const id of this.pending) {
        if (this.captured.get(id)?.rootNodeId === lineage.rootNodeId) {
          occupied.add(id)
        }
      }
      assertGrantRuntimeSpawnAllowed({ lineage, occupied: occupied.size, kind: input.kind })
      const permit = Object.freeze({}) as AgentSpawnPermit
      this.pending.add(input.nodeId)
      this.captured.set(input.nodeId, lineage)
      this.permits.set(permit, { ...input, used: false })
      try {
        return await create(permit, lineage)
      } finally {
        this.permits.delete(permit)
        this.pending.delete(input.nodeId)
        const bound = new Set(this.runtime.snapshot().bindings.map(b => b.nodeId))
        for (const id of this.captured.keys()) {
          if (!this.pending.has(id) && !bound.has(id)) {
            this.captured.delete(id)
          }
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  }
}
