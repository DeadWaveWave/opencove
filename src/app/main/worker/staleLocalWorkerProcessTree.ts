import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  killWindowsProcessTree,
  type WindowsProcessTreeKiller,
} from '../../../platform/process/ptyHost/windowsProcessTree'

const execFileAsync = promisify(execFile)
const PROCESS_QUERY_TIMEOUT_MS = 2_000
const PROCESS_QUERY_MAX_BUFFER_BYTES = 4 * 1024 * 1024
const PROCESS_EXIT_WAIT_MS = 1_500

export interface ProcessTreeRow {
  pid: number
  parentPid: number
  commandLine: string
}

export interface StaleLocalWorkerCleanupPlan {
  rootPid: number
  descendantPidsDeepestFirst: number[]
}

function normalizePathForComparison(value: string, platform: NodeJS.Platform): string {
  const normalized = value.replaceAll('\\', '/').replaceAll('"', '').trim()
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isVerifiedLocalWorkerCommand(
  commandLine: string,
  userDataPath: string,
  platform: NodeJS.Platform,
): boolean {
  const normalizedCommand = normalizePathForComparison(commandLine, platform)
  const normalizedUserData = normalizePathForComparison(userDataPath, platform)
  return (
    /(?:^|\/)worker\.js(?:\s|$)/u.test(normalizedCommand) &&
    normalizedCommand.includes('--started-by') &&
    normalizedCommand.includes('desktop') &&
    normalizedCommand.includes('--user-data') &&
    normalizedCommand.includes(normalizedUserData)
  )
}

export function planStaleLocalWorkerCleanup(options: {
  rows: readonly ProcessTreeRow[]
  stalePid: number
  userDataPath: string
  platform?: NodeJS.Platform
}): StaleLocalWorkerCleanupPlan | null {
  const platform = options.platform ?? process.platform
  const root = options.rows.find(row => row.pid === options.stalePid)
  if (!root || !isVerifiedLocalWorkerCommand(root.commandLine, options.userDataPath, platform)) {
    return null
  }

  const depthByPid = new Map<number, number>([[root.pid, 0]])
  let changed = true
  while (changed) {
    changed = false
    for (const row of options.rows) {
      if (depthByPid.has(row.pid)) {
        continue
      }
      const parentDepth = depthByPid.get(row.parentPid)
      if (parentDepth === undefined) {
        continue
      }
      depthByPid.set(row.pid, parentDepth + 1)
      changed = true
    }
  }

  return {
    rootPid: root.pid,
    descendantPidsDeepestFirst: [...depthByPid.entries()]
      .filter(([pid]) => pid !== root.pid)
      .sort((left, right) => right[1] - left[1] || right[0] - left[0])
      .map(([pid]) => pid),
  }
}

function parsePosixProcessTree(stdout: string): ProcessTreeRow[] {
  return stdout
    .split(/\r?\n/u)
    .map(line => /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      commandLine: match[3] ?? '',
    }))
}

function parseWindowsProcessTree(stdout: string): ProcessTreeRow[] {
  const parsed = JSON.parse(stdout) as unknown
  const values = Array.isArray(parsed) ? parsed : [parsed]
  return values
    .map(value => {
      if (typeof value !== 'object' || value === null) {
        return null
      }
      const row = value as Record<string, unknown>
      const pid = Number(row['ProcessId'])
      const parentPid = Number(row['ParentProcessId'])
      if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(parentPid)) {
        return null
      }
      return {
        pid,
        parentPid,
        commandLine: typeof row['CommandLine'] === 'string' ? row['CommandLine'] : '',
      }
    })
    .filter((row): row is ProcessTreeRow => row !== null)
}

export async function readSystemProcessTree(
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessTreeRow[]> {
  if (platform === 'win32') {
    const command = [
      'Get-CimInstance Win32_Process |',
      'Select-Object ProcessId,ParentProcessId,CommandLine |',
      'ConvertTo-Json -Compress',
    ].join(' ')
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
      timeout: PROCESS_QUERY_TIMEOUT_MS,
      maxBuffer: PROCESS_QUERY_MAX_BUFFER_BYTES,
      windowsHide: true,
    })
    return stdout.trim().length > 0 ? parseWindowsProcessTree(stdout) : []
  }

  if (platform === 'darwin' || platform === 'linux') {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
      timeout: PROCESS_QUERY_TIMEOUT_MS,
      maxBuffer: PROCESS_QUERY_MAX_BUFFER_BYTES,
      windowsHide: true,
    })
    return parsePosixProcessTree(stdout)
  }

  return []
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal)
}

async function waitForProcessExit(pids: readonly number[], timeoutMs: number): Promise<void> {
  await new Promise<void>(resolvePromise => {
    let interval: NodeJS.Timeout | null = null
    let timeout: NodeJS.Timeout | null = null
    const settle = (): void => {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      resolvePromise()
    }
    const check = (): void => {
      const anyAlive = pids.some(pid => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      })
      if (!anyAlive) {
        settle()
      }
    }
    interval = setInterval(check, 50)
    timeout = setTimeout(settle, Math.max(0, timeoutMs))
    interval.unref()
    timeout.unref()
    check()
  })
}

export async function terminateStaleLocalWorkerTree(
  options: {
    stalePid: number
    userDataPath: string
    platform?: NodeJS.Platform
  },
  dependencies: {
    readProcessTree?: () => Promise<ProcessTreeRow[]>
    signal?: (pid: number, signal: NodeJS.Signals) => void
    waitForExit?: (pids: readonly number[], timeoutMs: number) => Promise<void>
    killWindowsTree?: WindowsProcessTreeKiller['kill']
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  const readProcessTree =
    dependencies.readProcessTree ?? (async () => await readSystemProcessTree(platform))
  let rows: ProcessTreeRow[]
  try {
    rows = await readProcessTree()
  } catch {
    return
  }
  const plan = planStaleLocalWorkerCleanup({
    rows,
    stalePid: options.stalePid,
    userDataPath: options.userDataPath,
    platform,
  })
  if (!plan) {
    return
  }

  if (platform === 'win32') {
    try {
      killWindowsProcessTree(plan.rootPid, {
        platform,
        ...(dependencies.killWindowsTree ? { killer: { kill: dependencies.killWindowsTree } } : {}),
      })
    } catch {
      // Cleanup is best-effort during startup repair.
    }
    return
  }

  const signal = dependencies.signal ?? signalProcess
  const orderedPids = [...plan.descendantPidsDeepestFirst, plan.rootPid]
  for (const pid of orderedPids) {
    try {
      signal(pid, 'SIGTERM')
    } catch {
      // The process may already be gone or inaccessible.
    }
  }

  await (dependencies.waitForExit ?? waitForProcessExit)(orderedPids, PROCESS_EXIT_WAIT_MS).catch(
    () => undefined,
  )

  let remainingRows: ProcessTreeRow[]
  try {
    remainingRows = await readProcessTree()
  } catch {
    return
  }
  const originalCommandByPid = new Map(rows.map(row => [row.pid, row.commandLine]))
  for (const pid of orderedPids) {
    const remaining = remainingRows.find(row => row.pid === pid)
    if (!remaining || remaining.commandLine !== originalCommandByPid.get(pid)) {
      continue
    }
    try {
      signal(pid, 'SIGKILL')
    } catch {
      // The process may have exited between observation and signal.
    }
  }
}
