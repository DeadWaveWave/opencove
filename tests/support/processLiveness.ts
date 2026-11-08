import { readFileSync } from 'node:fs'

/** A zombie has already terminated; Linux container PID 1 may delay its wait/reap. */
export function isZombieProcess(pid: number): boolean {
  if (process.platform !== 'linux') {
    return false
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')
  } catch {
    return false
  }
}
