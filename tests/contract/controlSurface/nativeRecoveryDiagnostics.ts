import { onTestFailed } from 'vitest'
import { registerControlSurfaceHttpServer } from '../../../src/app/main/controlSurface/controlSurfaceHttpServer'
import { invoke } from './controlSurfaceHttpServer.sessionStreaming.testUtils'

/** Keep the five-second contract budget; identify the blocked boundary if CI exhausts it. */
export function createNativeRecoveryDiagnostics() {
  const startedAt = performance.now()
  const cpuStartedAt = process.cpuUsage()
  const pending = new Map<number, { operation: string; startedAtMs: number }>()
  const completed: Array<{ operation: string; durationMs: number; failed: boolean }> = []
  let nextId = 0
  const elapsed = () => Math.round(performance.now() - startedAt)
  const track = async <T>(operation: string, run: () => Promise<T>): Promise<T> => {
    const id = nextId++
    const startedAtMs = elapsed()
    pending.set(id, { operation, startedAtMs })
    let failed = false
    try {
      return await run()
    } catch (error) {
      failed = true
      throw error
    } finally {
      pending.delete(id)
      completed.push({ operation, durationMs: elapsed() - startedAtMs, failed })
    }
  }
  onTestFailed(() => {
    process.stderr.write(
      `[native-recovery] ${JSON.stringify({
        elapsedMs: elapsed(),
        cpuMicros: process.cpuUsage(cpuStartedAt),
        pending: [...pending.values()],
        completed,
      })}\n`,
    )
  })
  return {
    registerServer: (options: Parameters<typeof registerControlSurfaceHttpServer>[0]) => {
      const server = registerControlSurfaceHttpServer(options)
      const label = options.connectionFileName ?? 'control-surface.json'
      return {
        ready: track(`${label}: ready`, () => server.ready),
        dispose: () => track(`${label}: dispose`, () => server.dispose()),
      }
    },
    invoke: (...args: Parameters<typeof invoke>) => {
      const request = args[2] as { id?: string }
      return track(`${args[0]}: ${request.id ?? 'invoke'}`, () => invoke(...args))
    },
  }
}
