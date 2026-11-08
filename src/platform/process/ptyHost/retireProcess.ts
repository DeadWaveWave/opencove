import { PTY_HOST_SHUTDOWN_TIMEOUT_MS, PTY_HOST_EXIT_CONFIRM_TIMEOUT_MS } from './terminationTiming'
import type { PtyHostProcess } from './processTypes'
import { postPtyHostMessage } from './postMessage'

/** Graceful cleanup gets 4s; exact-child SIGKILL then gets 500ms exit observation. */
export function retirePtyHostProcess(
  child: PtyHostProcess,
  hostInstanceId: string | null,
  reportIssue: (message: string) => void = message => {
    process.stderr.write(`${message}\n`)
  },
): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    let fallback: NodeJS.Timeout | null = null
    const report = (message: string): void => {
      try {
        reportIssue(`[pty-host] ${message}`)
      } catch {
        /* Cleanup cannot depend on logging. */
      }
    }
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      if (fallback) {
        clearTimeout(fallback)
      }
      resolve()
    }
    const signal = (signalName: 'SIGTERM' | 'SIGKILL'): void => {
      if (settled) {
        return
      }
      try {
        if (!child.kill(signalName)) {
          report(`exact-child ${signalName} was not delivered`)
        }
      } catch (error) {
        report(`exact-child ${signalName} failed: ${String(error)}`)
      }
    }
    child.on('exit', finish)
    fallback = setTimeout(() => {
      signal('SIGKILL')
      if (settled) {
        return
      }
      fallback = setTimeout(() => {
        report('host exit unconfirmed 500ms after SIGKILL')
        finish()
      }, PTY_HOST_EXIT_CONFIRM_TIMEOUT_MS)
    }, PTY_HOST_SHUTDOWN_TIMEOUT_MS)
    if (!hostInstanceId) {
      signal('SIGTERM')
    } else {
      postPtyHostMessage(child, { type: 'shutdown', hostInstanceId }, () => signal('SIGTERM'))
    }
  })
}
