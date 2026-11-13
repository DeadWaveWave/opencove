/** A producer holds this capability; no timer or generation comparison can retire it. */
export interface ClaudeCaptureBinding {
  readonly serial: number
  readonly invocation: object
  readonly id?: string
  startAt?: number
  retired: boolean
}
export class ClaudeCaptureBindings {
  readonly invocation = {}
  private current = new Map<string, ClaudeCaptureBinding>()
  private all = new Set<ClaudeCaptureBinding>()
  private sequence = 0
  limited = false
  capture(id?: string, at?: number): ClaudeCaptureBinding {
    const known = this.current.get(id || '')
    if (at !== undefined && known?.startAt !== at) {
      return {
        serial: ++this.sequence,
        invocation: this.invocation,
        id,
        startAt: at,
        retired: [...this.all].some(b => b.startAt !== undefined && b.startAt > at),
      }
    }
    const key = id || ''
    let binding = this.current.get(key)
    if (!binding) {
      binding = {
        serial: ++this.sequence,
        invocation: this.invocation,
        id: id || undefined,
        retired: false,
      }
      this.current.set(key, binding)
      this.all.add(binding)
      if (this.current.size > 64) {
        const old = [...this.current].find(([, b]) => b.retired)
        if (old) {
          this.current.delete(old[0])
          this.all.delete(old[1])
        } else {
          this.limited = true
          this.current.delete(key)
          this.all.delete(binding)
        }
      }
    }
    return binding
  }
  start(id: string, at: number): void {
    for (const binding of this.all) {
      if (binding.startAt !== undefined && binding.startAt < at) {
        binding.retired = true
      }
    }
    const old = this.current.get(id)
    if (old?.startAt === at) {
      return
    }
    if (old?.startAt !== undefined && old.startAt > at) {
      return
    }
    const binding = old && old.startAt === undefined && !old.retired ? old : undefined
    if (old && !binding) {
      this.all.delete(old)
      this.current.delete(id)
    }
    const next = binding ?? this.capture(id)
    next.startAt = at
    next.retired = [...this.all].some(b => b.startAt !== undefined && b.startAt > at)
  }
  end(id: string, at: number): void {
    const binding = this.current.get(id)
    if (binding && binding.startAt !== undefined && binding.startAt <= at) {
      binding.retired = true
    }
  }
  owns(binding: ClaudeCaptureBinding): boolean {
    return binding.invocation === this.invocation
  }
  dispose(): void {
    for (const binding of this.all) {
      binding.retired = true
    }
    this.all.clear()
    this.current.clear()
  }
}
