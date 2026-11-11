import path, { type PlatformPath } from 'node:path'
import { createAppError } from '../../../../shared/errors/appError'
import { spawnForbiddenDetails } from '../../../../shared/errors/agentSpawnError'
import type { NodeLineageRecord } from '../../domain/nodeLineage'
import { assertGrantRuntimeSpawnAllowed } from '../../domain/agentSpawnPolicy'
import { deriveNodeLineage } from '../../domain/nodeLineage'
import type { NodeControlAppStateStore } from '../nodeControl/nodeControlState'
import type { ResolvedNodeCreationTarget } from '../nodeControl/nodeCreationTarget'
import type { AgentSpawnRuntimePort, NodeRuntimeBinding } from './AgentSpawnRuntimePort'

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
export function spawnTargetKey(
  target: ResolvedNodeCreationTarget,
  paths: Pick<PlatformPath, 'normalize'> = path,
): string {
  return JSON.stringify([
    target.workspace.id,
    target.space?.id,
    target.mount?.mountId,
    target.endpoint.endpointId,
    paths.normalize(target.workingDirectory),
  ])
}

/** Caller holds the existing node mutation queue through runCreation settlement. */
export class AgentSpawnAdmissionOwner {
  private readonly pending = new Set<string>()
  private readonly captured = new Map<string, NodeLineageRecord>()
  private readonly permits = new Map<AgentSpawnPermit, Admission & { used: boolean }>()
  private readonly historicalFences = new Set<string>()
  private readonly knownLocalNodeIds = new Set<string>()
  private readonly nonRuntimeCreations = new Set<string>()
  private readonly seededBindings = new Map<string, NodeRuntimeBinding>()
  private auditedRevision: number | undefined
  public constructor(
    private readonly runtime: AgentSpawnRuntimePort,
    private readonly paths: Pick<PlatformPath, 'normalize'> = path,
  ) {}

  /** Called only by the creation factory branch that cannot launch an agent or terminal. */
  public noteNonRuntimeCreation(nodeId: string): void {
    this.nonRuntimeCreations.add(nodeId)
  }

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
    if (
      !entry ||
      this.paths.normalize(execution.cwd) !== this.paths.normalize(entry.target.workingDirectory)
    ) {
      forbidden('remote_spawning_unsupported')
    }
  }
  public assertTarget(permit: AgentSpawnPermit, target: ResolvedNodeCreationTarget): void {
    const entry = this.permits.get(permit)
    if (
      !entry ||
      target.endpoint.kind === 'remote_worker' ||
      spawnTargetKey(entry.target, this.paths) !== spawnTargetKey(target, this.paths)
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
      const persistedNodeIds = new Set(nodes.map(node => node.id))
      const caller = nodes.find(n => n.id === input.authority.nodeId)
      if (
        !caller ||
        !['agent', 'terminal'].includes(caller.kind) ||
        caller.sessionId !== input.authority.sessionId
      ) {
        forbidden('caller_session_mismatch')
      }
      const census = this.runtime.snapshot()
      const completed = new Set(census.completedSessionIds ?? [])
      const seeded = new Map(this.seededBindings)
      for (const id of completed) {
        seeded.delete(id)
      }
      const capturedSessions = new Set(census.bindings.map(binding => binding.sessionId))
      for (const node of nodes) {
        if (
          node.sessionId &&
          ['agent', 'terminal'].includes(node.kind) &&
          !capturedSessions.has(node.sessionId) &&
          !completed.has(node.sessionId) &&
          this.runtime.isSessionActive?.(node.sessionId)
        ) {
          seeded.set(node.sessionId, {
            nodeId: node.id,
            sessionId: node.sessionId,
            runtimeOwner:
              node.workerBinding?.endpointId && node.workerBinding.endpointId !== 'local'
                ? 'remote'
                : 'local',
            state: 'running',
          })
        }
      }
      const bindings = [...census.bindings, ...seeded.values()]
      const knownLocalNodes = new Set([
        ...this.knownLocalNodeIds,
        ...(census.knownLocalNodeIds ?? []),
        ...bindings.filter(b => b.runtimeOwner === 'local').map(b => b.nodeId),
      ])
      const ids = [
        ...new Set([
          input.authority.nodeId!,
          ...(census.knownRemoteNodeIds ?? []),
          ...bindings.map(b => b.nodeId),
          ...nodes.map(n => n.id),
        ]),
      ]
      const orphanRoots = new Set<string>()
      let rows: ReadonlyMap<string, NodeLineageRecord>
      try {
        rows = await store.nodeLineage.readMany(ids)
        if (this.auditedRevision !== revision) {
          // An orphan's endpoint/session is not durable. Never assume it was local or exited.
          const history = await store.nodeLineage.readAll?.()
          if (!history) {
            spawnAccountingUnavailable()
          }
          for (const row of history.values()) {
            if (
              !persistedNodeIds.has(row.nodeId) &&
              !knownLocalNodes.has(row.nodeId) &&
              !this.nonRuntimeCreations.has(row.nodeId)
            ) {
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
      this.seededBindings.clear()
      for (const [id, binding] of seeded) {
        this.seededBindings.set(id, binding)
      }
      this.auditedRevision = revision
      for (const id of knownLocalNodes) {
        this.knownLocalNodeIds.add(id)
      }
      // Retain all observed remote roots independently of subsequent membership deletion/rebind.
      for (const node of nodes) {
        const record = rows.get(node.id)
        if (record && node.workerBinding?.endpointId && node.workerBinding.endpointId !== 'local') {
          this.historicalFences.add(record.rootNodeId)
        }
      }
      for (const binding of bindings) {
        const record = this.captured.get(binding.nodeId) ?? rows.get(binding.nodeId)
        if (record) {
          this.captured.set(binding.nodeId, record)
        }
        if (record && binding.runtimeOwner === 'remote') {
          this.historicalFences.add(record.rootNodeId)
        }
      }
      for (const nodeId of census.knownRemoteNodeIds ?? []) {
        const record = this.captured.get(nodeId) ?? rows.get(nodeId)
        if (record) {
          this.historicalFences.add(record.rootNodeId)
        }
      }
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
      for (const id of this.pending) {
        if (this.captured.get(id)?.rootNodeId === lineage.rootNodeId) {
          occupied.add(id)
        }
      }
      assertGrantRuntimeSpawnAllowed({ lineage, occupied: occupied.size, kind: input.kind })
      const permit = Object.freeze({}) as AgentSpawnPermit
      this.pending.add(input.nodeId)
      this.captured.set(input.nodeId, lineage)
      this.knownLocalNodeIds.add(input.nodeId)
      this.permits.set(permit, { ...input, used: false })
      try {
        return await create(permit, lineage)
      } finally {
        this.permits.delete(permit)
        this.pending.delete(input.nodeId)
        const bound = new Set(
          [...this.runtime.snapshot().bindings, ...this.seededBindings.values()].map(b => b.nodeId),
        )
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
