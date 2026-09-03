import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import { isCodexActiveWriterError } from './codexResumeRecovery'

const MAX_STARTUP_OBSERVATION_MS = 2_000
const POST_EXIT_OUTPUT_DRAIN_MS = 1_000

type StartupPtyRuntime = Pick<ControlSurfacePtyRuntime, 'onData' | 'onExit' | 'kill'>

function boundedObservationMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.min(MAX_STARTUP_OBSERVATION_MS, Math.floor(value))
}

export async function launchAgentWithStartupObservation<
  TResult extends { sessionId: string },
>(options: {
  launch: () => Promise<TResult>
  ptyRuntime: StartupPtyRuntime
  observationMs: number
}): Promise<TResult> {
  const dataBySessionId = new Map<string, string>()
  const exitedSessionIds = new Set<string>()
  let observedSessionId: string | null = null
  let resolveObservation: (() => void) | null = null
  let armObservationTimer: ((delayMs: number) => void) | null = null
  let timer: NodeJS.Timeout | null = null

  const signalObservation = (sessionId: string): void => {
    const output = dataBySessionId.get(sessionId) ?? ''
    if (observedSessionId === sessionId && isCodexActiveWriterError(output)) {
      resolveObservation?.()
    }
  }
  const disposeData = options.ptyRuntime.onData(event => {
    const previous = dataBySessionId.get(event.sessionId) ?? ''
    dataBySessionId.set(event.sessionId, `${previous}${event.data}`.slice(-16_384))
    signalObservation(event.sessionId)
  })
  const disposeExit = options.ptyRuntime.onExit(event => {
    exitedSessionIds.add(event.sessionId)
    if (observedSessionId === event.sessionId) {
      armObservationTimer?.(POST_EXIT_OUTPUT_DRAIN_MS)
    }
    signalObservation(event.sessionId)
  })

  try {
    const launched = await options.launch()
    observedSessionId = launched.sessionId
    const observationMs = boundedObservationMs(options.observationMs)

    if (observationMs > 0) {
      await new Promise<void>(resolvePromise => {
        let settled = false
        const hardDeadlineMs = Date.now() + MAX_STARTUP_OBSERVATION_MS
        const settle = (): void => {
          if (settled) {
            return
          }
          settled = true
          resolveObservation = null
          armObservationTimer = null
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          resolvePromise()
        }
        const armTimer = (delayMs: number): void => {
          if (settled) {
            return
          }
          if (timer) {
            clearTimeout(timer)
          }
          const remainingMs = Math.max(0, hardDeadlineMs - Date.now())
          timer = setTimeout(settle, Math.min(delayMs, remainingMs))
          timer.unref()
        }
        resolveObservation = settle
        armObservationTimer = armTimer
        armTimer(
          exitedSessionIds.has(launched.sessionId) ? POST_EXIT_OUTPUT_DRAIN_MS : observationMs,
        )
        signalObservation(launched.sessionId)
      })
    }

    const output = dataBySessionId.get(launched.sessionId) ?? ''
    if (isCodexActiveWriterError(output)) {
      try {
        options.ptyRuntime.kill(launched.sessionId)
      } catch {
        // The failed PTY may already have exited.
      }
      throw new Error(output.trim() || 'Codex thread already has an active writer (-32600)')
    }
    if (exitedSessionIds.has(launched.sessionId)) {
      throw new Error(output.trim() || 'Agent resume exited during startup')
    }
    return launched
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    resolveObservation = null
    armObservationTimer = null
    disposeData()
    disposeExit()
  }
}
