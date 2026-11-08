import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'

/** Observe actual writes at the shared Hub boundary, including UI and automation writers. */
export class PtyStreamInputEvidence {
  private readonly listeners = new Map<string, Set<(deliveryId?: string, data?: string) => void>>()
  constructor(private readonly runtime: ControlSurfacePtyRuntime) {}
  watch(sessionId: string, listener: (deliveryId?: string, data?: string) => void): () => void {
    const set = this.listeners.get(sessionId) ?? new Set()
    this.listeners.set(sessionId, set)
    set.add(listener)
    return () => {
      set.delete(listener)
      if (!set.size) {
        this.listeners.delete(sessionId)
      }
    }
  }
  write(sessionId: string, data: string, deliveryId?: string): void {
    if (data.length) {
      for (const listener of this.listeners.get(sessionId) ?? []) {
        listener(deliveryId, data)
      }
    }
    this.runtime.write(sessionId, data)
  }
  observedRuntime(): ControlSurfacePtyRuntime {
    return new Proxy(this.runtime, {
      get: (target, key) =>
        key === 'write'
          ? this.write.bind(this)
          : typeof Reflect.get(target, key) === 'function'
            ? Reflect.get(target, key).bind(target)
            : Reflect.get(target, key),
    })
  }
}
