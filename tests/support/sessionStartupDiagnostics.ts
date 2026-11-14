import { createHook } from 'node:async_hooks'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { onTestFailed, onTestFinished } from 'vitest'

type Operation = { name: string; startedMs: number; durationMs?: number; stack?: string }

/** Keep evidence even when the test deadline interrupts an await outside drain(). */
export function sessionStartupDiagnostics(snapshot: () => unknown) {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  const phases: Operation[] = []
  const pendingIO = new Map<number, Operation>()
  const completedIO: Operation[] = []
  const loopDelay = monitorEventLoopDelay({ resolution: 20 })
  const hook = createHook({
    init(id, type) {
      if (type !== 'FSREQPROMISE' && type !== 'FILEHANDLECLOSEREQ') {
        return
      }
      pendingIO.set(id, {
        name: type,
        startedMs: elapsed(),
        stack: new Error().stack?.split('\n').slice(2, 8).join('\n'),
      })
    },
    destroy(id) {
      const operation = pendingIO.get(id)
      if (operation) {
        operation.durationMs = elapsed() - operation.startedMs
        pendingIO.delete(id)
        completedIO.push(operation)
        if (completedIO.length > 32) {
          completedIO.shift()
        }
      }
    },
  })
  hook.enable()
  loopDelay.enable()
  onTestFinished(() => {
    hook.disable()
    loopDelay.disable()
  })
  onTestFailed(() => {
    console.error(
      '[agent-session-startup]',
      JSON.stringify({
        elapsedMs: elapsed(),
        phases,
        watcher: snapshot(),
        pendingIO: [...pendingIO.values()],
        completedIO,
        maxEventLoopDelayMs: Math.round(loopDelay.max / 1e6),
      }),
    )
  })
  return async <T>(name: string, action: () => T | Promise<T>): Promise<T> => {
    const phase: Operation = { name, startedMs: elapsed() }
    phases.push(phase)
    try {
      return await action()
    } finally {
      phase.durationMs = elapsed() - phase.startedMs
    }
  }
}
