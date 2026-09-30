interface Lease<T> {
  id: string
  token: string
  value: T
  connections: Set<() => void>
  cancelExpiry: (() => void) | null
}

/** Native stream presence keeps a view alive; disconnected views have a bounded grace period. */
export class PluginViewLeases<T> {
  private readonly views = new Map<string, Lease<T>>()
  private readonly tokens = new Map<string, Lease<T>>()
  constructor(
    private readonly options: {
      scheduleExpiry: (expire: () => void) => () => void
      onExpired: (viewId: string) => void
    },
  ) {}

  get size(): number {
    return this.views.size
  }
  values(): T[] {
    return [...this.views.values()].map(lease => lease.value)
  }
  get(id: string): T | undefined {
    return this.views.get(id)?.value
  }
  getByToken(token: string): T | undefined {
    return this.tokens.get(token)?.value
  }
  hasToken(token: string): boolean {
    return this.tokens.has(token)
  }

  add(id: string, token: string, value: T): void {
    const lease: Lease<T> = { id, token, value, connections: new Set(), cancelExpiry: null }
    this.views.set(id, lease)
    this.tokens.set(token, lease)
    this.arm(lease)
  }

  private arm(lease: Lease<T>): void {
    lease.cancelExpiry?.()
    lease.cancelExpiry = this.options.scheduleExpiry(() => {
      lease.cancelExpiry = null
      if (this.views.get(lease.id) === lease && lease.connections.size === 0) {
        this.options.onExpired(lease.id)
      }
    })
  }

  attach(token: string, onRetired: () => void): (() => void) | null {
    const lease = this.tokens.get(token)
    if (!lease) {
      return null
    }
    lease.cancelExpiry?.()
    lease.cancelExpiry = null
    lease.connections.add(onRetired)
    let detached = false
    return () => {
      if (detached) {
        return
      }
      detached = true
      lease.connections.delete(onRetired)
      if (this.views.get(lease.id) === lease && lease.connections.size === 0) {
        this.arm(lease)
      }
    }
  }

  remove(id: string): T | undefined {
    const lease = this.views.get(id)
    if (!lease) {
      return undefined
    }
    this.views.delete(id)
    this.tokens.delete(lease.token)
    lease.cancelExpiry?.()
    for (const retire of lease.connections) {
      try {
        retire()
      } catch {
        /* A closed transport cannot prevent lease revocation. */
      }
    }
    lease.connections.clear()
    return lease.value
  }
}
