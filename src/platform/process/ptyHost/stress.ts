import { app, utilityProcess } from 'electron'
import { execSync } from 'node:child_process'
import process from 'node:process'
import { resolve as pathResolve } from 'node:path'
import { PtyHostSupervisor } from './supervisor'

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

function tryResolveRssKb(pid: number | undefined): number | null {
  if (!pid) {
    return null
  }

  if (process.platform === 'win32') {
    return null
  }

  try {
    const output = execSync(`ps -o rss= -p ${pid}`, { stdio: 'pipe' }).toString().trim()
    const rssKb = Number.parseInt(output, 10)
    return Number.isFinite(rssKb) ? rssKb : null
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const kib = bytes / 1024
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`
  }

  const mib = kib / 1024
  if (mib < 1024) {
    return `${mib.toFixed(1)} MiB`
  }

  const gib = mib / 1024
  return `${gib.toFixed(2)} GiB`
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise
      .then(value => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(error => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

export async function runPtyHostStressTest(): Promise<void> {
  if (!isTruthyEnv(process.env['OPENCOVE_PTY_HOST_STRESS'])) {
    return
  }

  if (process.platform === 'win32') {
    throw new Error('[cove] pty-host stress currently supports only macOS/Linux')
  }

  const sessionCount = parsePositiveInt(process.env['OPENCOVE_PTY_HOST_STRESS_SESSIONS'], 8)
  const bytesPerSession = parsePositiveInt(process.env['OPENCOVE_PTY_HOST_STRESS_BYTES'], 2_000_000)
  const concurrency = parsePositiveInt(
    process.env['OPENCOVE_PTY_HOST_STRESS_CONCURRENCY'],
    Math.min(8, sessionCount),
  )
  const timeoutMs = parsePositiveInt(process.env['OPENCOVE_PTY_HOST_STRESS_TIMEOUT_MS'], 60_000)

  const logsDir = pathResolve(app.getPath('userData'), 'logs')
  const logFilePath = pathResolve(logsDir, 'pty-host-stress.log')

  let hostPid: number | undefined
  let hostRssStartKb: number | null = null

  const ptyHost = new PtyHostSupervisor({
    baseDir: __dirname,
    logFilePath,
    reportIssue: message => process.stderr.write(`${message}\n`),
    createProcess: modulePath => {
      const child = utilityProcess.fork(modulePath, [], {
        stdio: 'pipe',
        serviceName: 'OpenCove PTY Host (Stress)',
      })
      hostPid = child.pid
      hostRssStartKb = tryResolveRssKb(child.pid)
      return child
    },
  })

  const bytesBySession = new Map<string, number>()
  const exitCodeBySession = new Map<string, number>()
  const exitWaiters = new Map<string, (exitCode: number) => void>()

  const unsubscribeData = ptyHost.onData(({ sessionId, data }) => {
    const bytes = Buffer.byteLength(data)
    bytesBySession.set(sessionId, (bytesBySession.get(sessionId) ?? 0) + bytes)
  })

  const unsubscribeExit = ptyHost.onExit(({ sessionId, exitCode }) => {
    exitCodeBySession.set(sessionId, exitCode)
    exitWaiters.get(sessionId)?.(exitCode)
    exitWaiters.delete(sessionId)
  })

  const startRss = process.memoryUsage().rss
  const startNs = process.hrtime.bigint()

  const script = `head -c ${bytesPerSession} /dev/zero | tr '\\\\000' 'X'`
  const sessionIds: string[] = []

  let nextSessionIndex = 0

  const spawnNextSession = async (): Promise<void> => {
    const index = nextSessionIndex
    if (index >= sessionCount) {
      return
    }

    nextSessionIndex += 1
    const { sessionId } = await ptyHost.spawn({
      command: '/bin/sh',
      args: ['-lc', script],
      cwd: process.cwd(),
      env: { ...process.env },
      cols: 80,
      rows: 24,
    })
    sessionIds.push(sessionId)
    await spawnNextSession()
  }

  const workers = Array.from({ length: concurrency }, () => spawnNextSession())

  await withTimeout(
    Promise.all(workers),
    timeoutMs,
    `[cove] pty-host stress timed out while spawning sessions after ${timeoutMs}ms`,
  )

  const exitPromises = sessionIds.map(sessionId => {
    const existingExitCode = exitCodeBySession.get(sessionId)
    if (existingExitCode !== undefined) {
      return Promise.resolve(existingExitCode)
    }

    const exitPromise = new Promise<number>(fulfill => {
      exitWaiters.set(sessionId, fulfill)
    })

    return withTimeout(
      exitPromise,
      timeoutMs,
      `[cove] pty-host stress timed out waiting for session exit after ${timeoutMs}ms: ${sessionId}`,
    )
  })

  await Promise.all(exitPromises)

  const endNs = process.hrtime.bigint()
  const endRss = process.memoryUsage().rss
  const hostRssEndKb = tryResolveRssKb(hostPid)

  let totalBytes = 0
  let nonZeroExits = 0
  for (const sessionId of sessionIds) {
    totalBytes += bytesBySession.get(sessionId) ?? 0
    const exitCode = exitCodeBySession.get(sessionId)
    if (exitCode !== undefined && exitCode !== 0) {
      nonZeroExits += 1
    }
  }

  const durationSeconds = Number(endNs - startNs) / 1e9
  const throughputMiBPerSecond =
    durationSeconds > 0 ? totalBytes / durationSeconds / 1024 / 1024 : Number.NaN

  process.stderr.write(
    [
      '[cove] pty-host stress completed',
      `sessions=${sessionCount}`,
      `bytesPerSession=${formatBytes(bytesPerSession)}`,
      `total=${formatBytes(totalBytes)}`,
      `duration=${durationSeconds.toFixed(2)}s`,
      `throughput=${throughputMiBPerSecond.toFixed(1)} MiB/s`,
      `mainRssΔ=${formatBytes(endRss - startRss)}`,
      `hostPid=${hostPid ?? 'unknown'}`,
      `hostRssKb=${hostRssStartKb ?? 'n/a'}->${hostRssEndKb ?? 'n/a'}`,
      `nonZeroExits=${nonZeroExits}`,
      `log=${logFilePath}`,
    ].join(' '),
  )
  process.stderr.write('\n')

  unsubscribeData()
  unsubscribeExit()
  ptyHost.dispose()
}
