import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import type { ElectronApplication } from '@playwright/test'

export async function readElectronMainProcessPid(
  app: Pick<ElectronApplication, 'evaluate'>,
): Promise<number> {
  // Playwright's Windows ChildProcess owns the shell launcher, not the browser.
  return await app.evaluate(() => process.pid)
}

export async function withRecoveryDeadline<T>(
  stage: string,
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} exceeded ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// Serialized into Electron's main process. Keep all runtime dependencies inside this function.
export function createRendererRecoveryProbe(window: BrowserWindow) {
  const contents = window.webContents
  const startedAt = Date.now()
  const initialRendererPid = contents.getOSProcessId()
  const events: Array<{ event: string; elapsedMs: number }> = []
  let gone: { reason: string; exitCode: number } | null = null
  let loadFailure: { code: number; description: string } | null = null
  let finishedLoads = 0
  const record = (event: string): void => {
    events.push({ event, elapsedMs: Date.now() - startedAt })
    if (events.length > 32) {
      events.shift()
    }
  }
  const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void => {
    gone = { reason: details.reason, exitCode: details.exitCode }
    record('render-process-gone')
  }
  const onStart = (): void => record('did-start-loading')
  const onFinish = (): void => {
    finishedLoads += 1
    record('did-finish-load')
  }
  const onStop = (): void => record('did-stop-loading')
  const onFail = (_event: Electron.Event, code: number, description: string): void => {
    loadFailure = { code, description }
    record('did-fail-load')
  }
  const dispose = (): void => {
    contents.removeListener('render-process-gone', onGone)
    contents.removeListener('did-start-loading', onStart)
    contents.removeListener('did-finish-load', onFinish)
    contents.removeListener('did-stop-loading', onStop)
    contents.removeListener('did-fail-load', onFail)
    contents.removeListener('destroyed', dispose)
  }
  contents.on('render-process-gone', onGone)
  contents.on('did-start-loading', onStart)
  contents.on('did-finish-load', onFinish)
  contents.on('did-stop-loading', onStop)
  contents.on('did-fail-load', onFail)
  contents.on('destroyed', dispose)

  return {
    trigger(): void {
      record('crash-requested')
      contents.forcefullyCrashRenderer()
      // Never return a promise waiting on a native event through the inspector.
      record('crash-call-returned')
    },
    snapshot() {
      const destroyed = window.isDestroyed() || contents.isDestroyed()
      return {
        mainPid: process.pid,
        coreLimitBeforeLaunch: process.env['OPENCOVE_E2E_INITIAL_CORE_LIMIT'],
        initialRendererPid,
        rendererPid: destroyed ? null : contents.getOSProcessId(),
        destroyed,
        crashed: destroyed ? null : contents.isCrashed(),
        loading: destroyed ? null : contents.isLoading(),
        rendererSandbox: destroyed ? null : contents.getLastWebPreferences().sandbox,
        gone,
        finishedLoads,
        loadFailure,
        events: [...events],
      }
    },
    dispose,
  }
}

export async function readRecoveryProcessState(pids: number[]) {
  const corePattern =
    process.platform === 'linux'
      ? await readFile('/proc/sys/kernel/core_pattern', 'utf8').catch(error => String(error))
      : undefined
  return await Promise.all(
    [...new Set(pids)].map(async pid => {
      let alive = true
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
      }
      if (process.platform !== 'linux' || !alive) {
        return { pid, alive }
      }
      const read = async (name: string): Promise<string> =>
        await readFile(`/proc/${pid}/${name}`, 'utf8').catch(error => String(error))
      const [status, waitChannel, limits] = await Promise.all([
        read('status'),
        read('wchan'),
        read('limits'),
      ])
      return {
        pid,
        alive,
        corePattern,
        limits,
        status: status
          .split('\n')
          .filter(line =>
            /^(Name|State|Pid|PPid|TracerPid|VmRSS|CoreDumping|Threads):/u.test(line),
          ),
        waitChannel: waitChannel.slice(0, 256),
      }
    }),
  )
}
