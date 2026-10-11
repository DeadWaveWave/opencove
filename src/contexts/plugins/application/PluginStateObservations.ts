import type { PluginHostAuthority } from '../domain/pluginHostTypes'
import type { PluginObservationBatch, PluginObservationType } from '../domain/pluginCanvasTypes'

export type PluginObservationSnapshot = Map<PluginObservationType, Map<string, string>>
interface Lease {
  ownerId: string
  projectId: string
  types: PluginObservationType[]
  authority: PluginHostAuthority
  baseline: PluginObservationSnapshot
  sequence: number
  polling: boolean
  touched: number
  sampled: number
}

/** Sampling lease, not an event log. No replay, timer, or durable subscription state. */
export class PluginStateObservations {
  private readonly leases = new Map<string, Lease>()
  constructor(
    private readonly snapshot: (
      authority: PluginHostAuthority,
      projectId: string,
      types: PluginObservationType[],
    ) => Promise<PluginObservationSnapshot>,
    private readonly createId: () => string,
    private readonly now = Date.now,
  ) {}

  async subscribe(
    authority: PluginHostAuthority,
    projectId: string,
    types: PluginObservationType[],
  ) {
    this.prune()
    authority.assertActive()
    if (
      this.leases.size >= 32 ||
      [...this.leases.values()].filter(item => item.ownerId === authority.ownerId).length >= 4
    ) {
      throw new Error('Plugin observation limit reached; dispose an existing subscription.')
    }
    const id = this.createId()
    const lease: Lease = {
      ownerId: authority.ownerId,
      projectId,
      types,
      authority,
      baseline: new Map(),
      sequence: 0,
      polling: true,
      touched: this.now(),
      sampled: 0,
    }
    this.leases.set(id, lease)
    try {
      lease.baseline = await this.snapshot(authority, projectId, types)
      this.active(id, authority)
      lease.sampled = this.now()
      lease.polling = false
      return { subscriptionId: id }
    } catch (error) {
      this.leases.delete(id)
      throw error
    }
  }

  async poll(authority: PluginHostAuthority, id: string): Promise<PluginObservationBatch> {
    this.prune()
    const lease = this.active(id, authority)
    if (lease.polling) {
      throw new Error('Only one poll may be pending per subscription.')
    }
    lease.touched = this.now()
    if (this.now() - lease.sampled < 250) {
      return { subscriptionId: id, sequence: lease.sequence, changes: [], truncated: false }
    }
    lease.polling = true
    try {
      const next = await this.snapshot(authority, lease.projectId, lease.types)
      this.active(id, authority)
      const changes: PluginObservationBatch['changes'] = []
      let total = 0
      for (const type of lease.types) {
        const before = lease.baseline.get(type) ?? new Map()
        const after = next.get(type) ?? new Map()
        for (const entityId of new Set([...before.keys(), ...after.keys()])) {
          if (before.get(entityId) === after.get(entityId)) {
            continue
          }
          total += 1
          if (changes.length < 100) {
            changes.push({
              type,
              id: entityId,
              change: !after.has(entityId)
                ? 'removed'
                : !before.has(entityId)
                  ? 'created'
                  : 'changed',
            })
          }
        }
      }
      lease.baseline = next
      lease.sampled = this.now()
      if (total) {
        lease.sequence += 1
      }
      return {
        subscriptionId: id,
        sequence: lease.sequence,
        changes,
        truncated: total > changes.length,
      }
    } finally {
      lease.polling = false
    }
  }

  dispose(authority: PluginHostAuthority, id: string) {
    this.active(id, authority)
    this.leases.delete(id)
    return { disposed: true }
  }
  retire(ownerId: string) {
    for (const [id, lease] of this.leases) {
      if (lease.ownerId === ownerId) {
        this.leases.delete(id)
      }
    }
  }
  private active(id: string, authority: PluginHostAuthority) {
    authority.assertActive()
    const lease = this.leases.get(id)
    if (!lease || lease.ownerId !== authority.ownerId) {
      throw new Error('Plugin subscription is unavailable or expired.')
    }
    lease.authority.assertActive()
    return lease
  }
  private prune() {
    for (const [id, lease] of this.leases) {
      if (this.now() - lease.touched > 120_000) {
        this.leases.delete(id)
      }
    }
  }
}
