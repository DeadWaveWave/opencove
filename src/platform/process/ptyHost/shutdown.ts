import process from 'node:process'
import { PTY_HOST_SHUTDOWN_TIMEOUT_MS } from './terminationTiming'

/** The referenced deadline keeps a disconnected host alive until cleanup settles. */
export function createPtyHostShutdown(options: {
  cleanup: () => void
  drain: () => Promise<void>
  exit?: (code: number) => void
  reportIssue?: (message: string) => void
}): () => Promise<void> {
  const exit = options.exit ?? (code => process.exit(code))
  const reportIssue =
    options.reportIssue ??
    (message => {
      process.stderr.write(`${message}\n`)
    })
  let pending: Promise<void> | null = null
  return () => {
    if (pending) {
      return pending
    }
    let resolve!: () => void
    pending = new Promise<void>(done => {
      resolve = done
    })
    let finished = false
    const report = (message: string): void => {
      try {
        if (!finished) {
          reportIssue(`[pty-host] ${message}`)
        }
      } catch {
        /* Logging cannot break the exit bound. */
      }
    }
    const finish = (code: number): void => {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(deadline)
      resolve()
      exit(code)
    }
    // Do not unref: IPC disconnect may remove the host's last other live handle.
    const deadline = setTimeout(() => {
      report(
        `shutdown deadline reached after ${PTY_HOST_SHUTDOWN_TIMEOUT_MS}ms; retirement unconfirmed`,
      )
      finish(1)
    }, PTY_HOST_SHUTDOWN_TIMEOUT_MS)
    void (async () => {
      let code = 0
      try {
        options.cleanup()
      } catch (error) {
        code = 1
        report(`session cleanup failed: ${String(error)}`)
      }
      try {
        await options.drain()
      } catch (error) {
        code = 1
        report(`retirement drain failed: ${String(error)}`)
      }
      finish(code)
    })()
    return pending
  }
}
