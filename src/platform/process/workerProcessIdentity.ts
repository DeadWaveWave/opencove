import { execFile } from 'node:child_process'
import { readFile, readlink, realpath, stat } from 'node:fs/promises'
import { isAbsolute, sep } from 'node:path'
import { promisify } from 'node:util'
import { isWorkerPidPossiblyAlive } from './workerSingleInstanceLockFile'

const execFileAsync = promisify(execFile)
export type WorkerProcessIdentity = 'worker' | 'unrelated' | 'unknown' | 'dead'

/** ps / CommandLine text has lost argv boundaries. Never infer a different directory from it. */
export function classifyWorkerCommand(command: string): WorkerProcessIdentity {
  if (!command.trim() || /worker\.(?:js|cjs|mjs)(?:[\s"']|$)/u.test(command)) {
    return 'unknown'
  }
  return 'unrelated'
}

/** Exact argv plus the inspected process's cwd are required for relative userData paths. */
export async function classifyWorkerArguments(
  argv: readonly string[],
  userDataPath: string,
  cwd?: string,
): Promise<WorkerProcessIdentity> {
  if (argv.length === 0) {
    return 'unknown'
  }
  if (!argv.some(arg => /(?:^|[/\\])worker\.(?:js|cjs|mjs)$/u.test(arg))) {
    return 'unrelated'
  }
  const values = argv.flatMap((arg, index) => {
    if (arg === '--user-data') {
      return [argv[index + 1]]
    }
    if (arg.startsWith('--user-data=')) {
      return [arg.slice('--user-data='.length)]
    }
    return []
  })
  if (values.length !== 1 || !values[0]) {
    return 'unknown'
  }
  const candidate = values[0]
  if (!isAbsolute(candidate) && !cwd) {
    return 'unknown'
  }
  try {
    const [actual, expected] = await Promise.all([
      realpath(isAbsolute(candidate) ? candidate : `${cwd}${sep}${candidate}`),
      realpath(userDataPath),
    ])
    if (actual === expected) {
      return 'worker'
    }
    const [actualStat, expectedStat] = await Promise.all([stat(actual), stat(expected)])
    if (!actualStat.isDirectory() || !expectedStat.isDirectory()) {
      return 'unknown'
    }
    // Identity also handles filesystem aliases whose realpath spelling differs.
    if (actualStat.ino === 0 || expectedStat.ino === 0) {
      return 'unknown'
    }
    return actualStat.dev === expectedStat.dev && actualStat.ino === expectedStat.ino
      ? 'worker'
      : 'unrelated'
  } catch {
    return 'unknown'
  }
}

export async function inspectWorkerProcess(
  pid: number,
  userDataPath: string,
): Promise<WorkerProcessIdentity> {
  if (!isWorkerPidPossiblyAlive(pid)) {
    return 'dead'
  }
  try {
    if (pid === process.pid) {
      return await classifyWorkerArguments(process.argv, userDataPath, process.cwd())
    }
    if (process.platform === 'linux') {
      const [command, cwd] = await Promise.all([
        readFile(`/proc/${pid}/cmdline`, 'utf8'),
        readlink(`/proc/${pid}/cwd`),
      ])
      const argv = command.split('\0')
      if (argv.at(-1) === '') {
        argv.pop()
      }
      return await classifyWorkerArguments(argv, userDataPath, cwd)
    }
    const { stdout } =
      process.platform === 'win32'
        ? await execFileAsync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
            ],
            { timeout: 2000, maxBuffer: 1024 * 1024, windowsHide: true },
          )
        : await execFileAsync('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
            timeout: 2000,
            maxBuffer: 1024 * 1024,
          })
    return classifyWorkerCommand(stdout)
  } catch {
    return isWorkerPidPossiblyAlive(pid) ? 'unknown' : 'dead'
  }
}

/** Call only while holding the kernel lease. New-format metadata is then stale by proof. */
export async function legacyWorkerBlocksAcquisition(
  metadata: { pid: number; instanceId?: string } | null,
  userDataPath: string,
): Promise<boolean> {
  if (!metadata || (typeof metadata.instanceId === 'string' && metadata.instanceId.length > 0)) {
    return false
  }
  const identity = await inspectWorkerProcess(metadata.pid, userDataPath)
  return identity === 'worker' || identity === 'unknown'
}
