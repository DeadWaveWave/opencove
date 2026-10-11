import type { PluginHostAuthority, PluginResolvedTarget } from '../domain/pluginHostTypes'

export type PluginFileSample = Map<string, string>
export interface PluginFileWatchPort {
  sample(
    target: PluginResolvedTarget,
    path: string,
    assertActive: () => void,
  ): Promise<PluginFileSample>
}
interface Watch {
  id: string
  owner: string
  target: PluginResolvedTarget
  path: string
  snapshot: PluginFileSample | null
  sampledAt: number
  pending: boolean
  sequence: number
}

/** Demand-driven shallow observations; no background timers or OS handles. */
export class PluginFileWatches {
  private readonly watches = new Map<string, Watch>()
  constructor(
    private readonly port: PluginFileWatchPort,
    private readonly uuid: () => string,
    private readonly now = Date.now,
  ) {}

  async create(authority: PluginHostAuthority, target: PluginResolvedTarget, path: string) {
    authority.assertActive()
    if (
      this.watches.size >= 32 ||
      [...this.watches.values()].filter(w => w.owner === authority.ownerId).length >= 4
    ) {
      throw new Error('Too many plugin file watches (4 per owner, 32 total).')
    }
    const watch: Watch = {
      id: this.uuid(),
      owner: authority.ownerId,
      target,
      path,
      snapshot: null,
      sampledAt: 0,
      pending: true,
      sequence: 0,
    }
    this.watches.set(watch.id, watch)
    try {
      const check = () => this.assertCurrent(authority, watch)
      watch.snapshot = await this.port.sample(target, path, check)
      check()
      watch.sampledAt = this.now()
      watch.pending = false
      return { watchId: watch.id, target, intervalMs: 1000 }
    } catch (error) {
      this.watches.delete(watch.id)
      throw error
    }
  }

  async read(authority: PluginHostAuthority, id: string) {
    const watch = this.get(authority, id)
    const retryAfterMs = Math.max(0, 1000 - (this.now() - watch.sampledAt))
    const result = (
      events: { type: 'created' | 'changed' | 'deleted'; path: string }[],
      truncated = false,
      retry = 1000,
    ) => ({
      watchId: id,
      target: watch.target,
      events,
      truncated,
      sequence: watch.sequence,
      retryAfterMs: retry,
    })
    if (watch.pending || retryAfterMs) {
      return result([], false, retryAfterMs || 1000)
    }
    watch.pending = true
    watch.sampledAt = this.now()
    try {
      const check = () => this.assertCurrent(authority, watch)
      const next = await this.port.sample(watch.target, watch.path, check)
      check()
      const events: { type: 'created' | 'changed' | 'deleted'; path: string }[] = []
      for (const [path, state] of next) {
        if (!watch.snapshot?.has(path)) {
          events.push({ type: 'created', path })
        } else if (watch.snapshot.get(path) !== state) {
          events.push({ type: 'changed', path })
        }
      }
      for (const path of watch.snapshot?.keys() ?? []) {
        if (!next.has(path)) {
          events.push({ type: 'deleted', path })
        }
      }
      watch.snapshot = next
      watch.sampledAt = this.now()
      watch.sequence++
      return result(events.slice(0, 256), events.length > 256)
    } finally {
      watch.pending = false
    }
  }

  remove(authority: PluginHostAuthority, id: string) {
    this.get(authority, id)
    this.watches.delete(id)
    return { watchId: id, disposed: true }
  }

  retire(ownerId: string): void {
    for (const [id, watch] of this.watches) {
      if (watch.owner === ownerId) {
        this.watches.delete(id)
      }
    }
  }

  private get(authority: PluginHostAuthority, id: string) {
    authority.assertActive()
    const watch = this.watches.get(id)
    if (!watch || watch.owner !== authority.ownerId) {
      throw new Error('File watch is unavailable for this owner.')
    }
    return watch
  }

  private assertCurrent(authority: PluginHostAuthority, watch: Watch): void {
    authority.assertActive()
    if (this.watches.get(watch.id) !== watch) {
      throw new Error('File watch has been disposed.')
    }
  }
}
