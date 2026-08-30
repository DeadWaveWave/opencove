import type { PtyHostForegroundEvent } from './protocol'

type DataEvent = { sessionId: string; data: string }
type ExitEvent = { sessionId: string; exitCode: number }
type UnsubscribeFn = () => void

export class PtyHostSupervisorEventBus {
  private readonly dataListeners = new Set<(event: DataEvent) => void>()
  private readonly exitListeners = new Set<(event: ExitEvent) => void>()
  private readonly foregroundListeners = new Set<(event: PtyHostForegroundEvent) => void>()

  public onData(listener: (event: DataEvent) => void): UnsubscribeFn {
    return this.subscribe(this.dataListeners, listener)
  }

  public onExit(listener: (event: ExitEvent) => void): UnsubscribeFn {
    return this.subscribe(this.exitListeners, listener)
  }

  public onForeground(listener: (event: PtyHostForegroundEvent) => void): UnsubscribeFn {
    return this.subscribe(this.foregroundListeners, listener)
  }

  public emitData(event: DataEvent): void {
    this.dataListeners.forEach(listener => listener(event))
  }

  public emitExit(event: ExitEvent): void {
    this.exitListeners.forEach(listener => listener(event))
  }

  public emitForeground(event: PtyHostForegroundEvent): void {
    this.foregroundListeners.forEach(listener => listener(event))
  }

  private subscribe<Event>(
    listeners: Set<(event: Event) => void>,
    listener: (event: Event) => void,
  ): UnsubscribeFn {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}
