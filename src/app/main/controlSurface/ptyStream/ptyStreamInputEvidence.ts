import type { SessionInputProvenance } from '../../../../shared/runtime/sessionInputProvenance'
import type { TerminalWriteEncoding } from '../../../../shared/contracts/dto'
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
  write(
    sessionId: string,
    data: string,
    deliveryId?: string,
    provenance?: SessionInputProvenance,
    encoding?: TerminalWriteEncoding,
  ): void {
    if (data.length) {
      for (const listener of this.listeners.get(sessionId) ?? []) {
        listener(deliveryId, data)
      }
    }
    if (provenance) {
      this.runtime.write(sessionId, data, encoding, provenance)
    } else if (encoding !== undefined) {
      this.runtime.write(sessionId, data, encoding)
    } else {
      this.runtime.write(sessionId, data)
    }
  }
  observedRuntime(): ControlSurfacePtyRuntime {
    const write: ControlSurfacePtyRuntime['write'] = (id, data, encoding, provenance) =>
      this.write(id, data, undefined, provenance, encoding)
    return new Proxy(this.runtime, {
      get: (target, key) =>
        key === 'write'
          ? write
          : typeof Reflect.get(target, key) === 'function'
            ? Reflect.get(target, key).bind(target)
            : Reflect.get(target, key),
    })
  }
}
