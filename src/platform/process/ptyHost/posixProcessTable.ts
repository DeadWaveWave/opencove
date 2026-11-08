import { execFile } from 'node:child_process'
export const PROCESS_TABLE_READ_TIMEOUT_MS = 2_000

export interface ProcessIdentity {
  pid: number
  parentPid: number
  pgid: number
  startTime: string
  command: string
  state?: string
}

export interface ProcessTableSample {
  rows: ProcessIdentity[]
  complete: boolean
}
export interface ProcessTableReadOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export function parseProcessTable(stdout: string): ProcessTableSample {
  const lines = stdout.split(/\r?\n/u).filter(line => line.trim().length > 0)
  if (lines.length === 0) {
    throw new Error('empty process table')
  }
  const rows = new Map<number, ProcessIdentity>()
  const duplicates = new Set<number>()
  let complete = true
  for (const line of lines) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/u.exec(
        line,
      )
    if (!match) {
      complete = false
      continue
    }
    const pid = Number(match[1])
    const parentPid = Number(match[2])
    const pgid = Number(match[3])
    if (![pid, parentPid, pgid].every(Number.isSafeInteger) || !match[6]!.trim()) {
      complete = false
      continue
    }
    if (rows.has(pid) || duplicates.has(pid)) {
      // Ambiguous identities cannot be evidence for signalling or foreground state.
      rows.delete(pid)
      duplicates.add(pid)
      complete = false
      continue
    }
    // PID 0/1 and PGID 0 are legitimate system rows. Retain them as data;
    // ancestry traversal excludes non-signalable PID 0/1 as seeds and targets.
    rows.set(pid, {
      pid,
      parentPid,
      pgid,
      startTime: match[4]!.replace(/\s+/gu, ' '),
      state: match[5]!,
      command: match[6]!,
    })
  }
  if (rows.size === 0) {
    throw new Error('no usable process table rows')
  }
  return { rows: [...rows.values()], complete }
}

/** One asynchronous, bounded whole-table read shared by the PTY host. */
export async function readPosixProcessTable(
  options: ProcessTableReadOptions = {},
): Promise<ProcessTableSample> {
  return await new Promise<ProcessTableSample>((resolve, reject) => {
    execFile(
      '/bin/ps',
      ['-ax', '-o', 'pid=,ppid=,pgid=,lstart=,stat=,command='],
      {
        encoding: 'utf8',
        timeout: options.timeoutMs ?? PROCESS_TABLE_READ_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024,
        signal: options.signal,
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        try {
          resolve(parseProcessTable(stdout))
        } catch (failure) {
          reject(failure)
        }
      },
    )
  })
}

/** One adjacency index per sample/stage, shared across all sessions and validated seeds. */
export class ProcessTreeSnapshot {
  public readonly byPid: ReadonlyMap<number, ProcessIdentity>
  private readonly children = new Map<number, number[]>()
  public constructor(rows: readonly ProcessIdentity[]) {
    this.byPid = new Map(rows.map(row => [row.pid, row]))
    for (const row of rows) {
      const siblings = this.children.get(row.parentPid) ?? []
      siblings.push(row.pid)
      this.children.set(row.parentPid, siblings)
    }
  }
  public descendants(seeds: Iterable<number>): ProcessIdentity[] {
    const visited = new Set<number>()
    const result: ProcessIdentity[] = []
    const pending: Array<{ pid: number; expanded: boolean }> = [...seeds].map(pid => ({
      pid,
      expanded: false,
    }))
    while (pending.length > 0) {
      const { pid, expanded } = pending.pop()!
      if (pid <= 1 || !this.byPid.has(pid)) {
        continue
      }
      if (expanded) {
        result.push({ ...this.byPid.get(pid)! })
        continue
      }
      if (visited.has(pid)) {
        continue
      }
      visited.add(pid)
      pending.push({ pid, expanded: true })
      for (const child of this.children.get(pid) ?? []) {
        pending.push({ pid: child, expanded: false })
      }
    }
    return result
  }
}

export function snapshotProcessTree(
  rows: readonly ProcessIdentity[],
  rootPid: number,
): ProcessIdentity[] {
  return new ProcessTreeSnapshot(rows).descendants([rootPid])
}
