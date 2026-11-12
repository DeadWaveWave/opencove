import { readFileSync } from 'node:fs'

/** Missing rows in partial ps output cannot make a cleanup assertion pass. */
export function observedProcessAlive(
  identity: { pid: number; startTime: string },
  current: ReadonlyMap<number, string>,
  complete: boolean,
  probe: (pid: number) => unknown = pid => process.kill(pid, 0),
): boolean | 'unknown' {
  const startTime = current.get(identity.pid)
  if (startTime !== undefined) {
    return startTime === identity.startTime
  }
  if (complete) {
    return false
  }
  try {
    probe(identity.pid)
    return 'unknown'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false
    }
    throw error
  }
}

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
