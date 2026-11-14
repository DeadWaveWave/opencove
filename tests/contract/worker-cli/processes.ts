import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Only descendants of this fixture's Worker are owned; never inspect/kill by process name. */
export async function descendants(workerPid: number): Promise<number[]> {
  let rows: number[][]
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    ])
    const values = JSON.parse(stdout) as Array<{ ProcessId: number; ParentProcessId: number }>
    rows = values.map(row => [row.ProcessId, row.ParentProcessId])
  } else {
    const { stdout } = await exec('ps', ['-axo', 'pid=,ppid='])
    rows = stdout
      .trim()
      .split('\n')
      .map(line => line.trim().split(/\s+/).map(Number))
  }
  const owned = new Set([workerPid])
  let added = true
  while (added) {
    added = false
    for (const [pid, ppid] of rows) {
      if (owned.has(ppid) && !owned.has(pid)) {
        owned.add(pid)
        added = true
      }
    }
  }
  return [...owned]
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }
    throw error
  }
}
