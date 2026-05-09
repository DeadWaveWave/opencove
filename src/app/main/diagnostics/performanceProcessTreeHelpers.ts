import type { RawPerformanceProcessRow } from './performanceProcessClassifier'

const WORKER_PARENT_PID_PATTERN = /(?:^|\s)--parent-pid(?:=|\s+)"?(\d+)"?(?=\s|$)/i

function toProcessId(value: unknown): number | null {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null
  }
  return Math.trunc(numberValue)
}

function normalizeCommandLine(commandLine: string): string {
  return commandLine.replace(/\\/g, '/').toLowerCase()
}

function isOpenCoveWorkerCommandLine(commandLine: string): boolean {
  const normalized = normalizeCommandLine(commandLine)
  return (
    normalized.includes('worker.js') &&
    (normalized.includes('--started-by') ||
      normalized.includes('--user-data') ||
      normalized.includes('/out/main/worker.js'))
  )
}

export function readWorkerParentPidFromCommandLine(commandLine: string): number | null {
  if (!isOpenCoveWorkerCommandLine(commandLine)) {
    return null
  }

  const match = WORKER_PARENT_PID_PATTERN.exec(commandLine)
  if (!match?.[1]) {
    return null
  }

  return toProcessId(match[1])
}

export function discoverRelatedProcessRootPids(
  rows: ReadonlyArray<{ pid: number; commandLine: string }>,
  mainPid: number,
  localWorkerPid: number | null,
): number[] {
  const rootPids = new Set<number>([mainPid])
  if (localWorkerPid !== null && localWorkerPid > 0) {
    rootPids.add(localWorkerPid)
  }

  for (const row of rows) {
    const workerParentPid = readWorkerParentPidFromCommandLine(row.commandLine)
    if (workerParentPid === mainPid) {
      rootPids.add(row.pid)
    }
  }

  return [...rootPids]
}

function collectDescendantRawRows(
  rows: RawPerformanceProcessRow[],
  rootPid: number,
): RawPerformanceProcessRow[] {
  const byParent = new Map<number, RawPerformanceProcessRow[]>()
  for (const row of rows) {
    if (row.parentPid === null) {
      continue
    }
    const siblings = byParent.get(row.parentPid) ?? []
    siblings.push(row)
    byParent.set(row.parentPid, siblings)
  }

  const result: RawPerformanceProcessRow[] = []
  const stack = [rootPid]
  const seen = new Set<number>(stack)
  const root = rows.find(row => row.pid === rootPid)
  if (root) {
    result.push(root)
  }

  while (stack.length > 0) {
    const currentPid = stack.pop()
    if (typeof currentPid !== 'number') {
      continue
    }
    for (const child of byParent.get(currentPid) ?? []) {
      if (seen.has(child.pid)) {
        continue
      }
      seen.add(child.pid)
      result.push(child)
      stack.push(child.pid)
    }
  }

  return result
}

export function collectDescendantRawRowsForRoots(
  rows: RawPerformanceProcessRow[],
  rootPids: readonly number[],
): RawPerformanceProcessRow[] {
  const byPid = new Map<number, RawPerformanceProcessRow>()
  for (const rootPid of rootPids) {
    for (const row of collectDescendantRawRows(rows, rootPid)) {
      byPid.set(row.pid, row)
    }
  }

  return [...byPid.values()].sort((left, right) => left.pid - right.pid)
}
