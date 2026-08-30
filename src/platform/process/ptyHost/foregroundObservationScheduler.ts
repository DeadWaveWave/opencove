type Observation = () => void

type TimerMap = Map<string, NodeJS.Timeout>

export class PtyHostForegroundObservationScheduler {
  private readonly markerTimers: TimerMap = new Map()
  private readonly probeTimers: TimerMap = new Map()

  public scheduleMarker(sessionId: string, observation: Observation, delayMs = 350): void {
    this.schedule(this.markerTimers, sessionId, observation, delayMs)
  }

  public scheduleProbe(sessionId: string, observation: Observation, delayMs = 50): void {
    this.schedule(this.probeTimers, sessionId, observation, delayMs)
  }

  public clearSession(sessionId: string): void {
    this.clear(this.markerTimers, sessionId)
    this.clear(this.probeTimers, sessionId)
  }

  public dispose(): void {
    for (const timer of [...this.markerTimers.values(), ...this.probeTimers.values()]) {
      clearTimeout(timer)
    }
    this.markerTimers.clear()
    this.probeTimers.clear()
  }

  private schedule(
    timers: TimerMap,
    sessionId: string,
    observation: Observation,
    delayMs: number,
  ): void {
    this.clear(timers, sessionId)
    const timer = setTimeout(() => {
      if (timers.get(sessionId) !== timer) {
        return
      }
      timers.delete(sessionId)
      observation()
    }, delayMs)
    timer.unref()
    timers.set(sessionId, timer)
  }

  private clear(timers: TimerMap, sessionId: string): void {
    const timer = timers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionId)
    }
  }
}
