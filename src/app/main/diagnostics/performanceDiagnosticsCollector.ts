import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type {
  PerformanceDiagnosticsElectronMetric,
  PerformanceDiagnosticsProcess,
  PerformanceDiagnosticsProcessTreeStatus,
  PerformanceDiagnosticsSnapshotResult,
} from '../../../shared/contracts/dto'
import {
  normalizePerformanceProcessRow,
  summarizePerformanceProcesses,
  type RawPerformanceProcessRow,
} from './performanceProcessClassifier'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../shared/constants/controlSurface'

const execFileAsync = promisify(execFile)
const WINDOWS_PROCESS_QUERY_MAX_BUFFER_BYTES = 20 * 1024 * 1024
const WINDOWS_WORKER_PARENT_PID_PATTERN = /(?:^|\s)--parent-pid(?:=|\s+)"?(\d+)"?(?=\s|$)/i
const SELF_PROCESS_FALLBACK_NOTE =
  'Process-tree rows were unavailable; showing the current OpenCove main process as a fallback.'

export interface WindowsProcessRow {
  ProcessId?: unknown
  ParentProcessId?: unknown
  Name?: unknown
  CommandLine?: unknown
  WorkingSetSize?: unknown
  PrivatePageCount?: unknown
  UserModeTime?: unknown
  KernelModeTime?: unknown
  ThreadCount?: unknown
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function toProcessId(value: unknown): number | null {
  const numberValue = toFiniteNumber(value)
  if (numberValue === null || numberValue < 0) {
    return null
  }
  return Math.trunc(numberValue)
}

function toNonNegativeNumber(value: unknown): number | null {
  const numberValue = toFiniteNumber(value)
  if (numberValue === null || numberValue < 0) {
    return null
  }
  return numberValue
}

function toCpuTimeMs(value: unknown): number | null {
  const time100ns = toNonNegativeNumber(value)
  return time100ns === null ? null : Math.round(time100ns / 10_000)
}

function normalizeWindowsRows(value: unknown): WindowsProcessRow[] {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

export function collectDescendantRows(
  rows: WindowsProcessRow[],
  rootPid: number,
): WindowsProcessRow[] {
  const byParent = new Map<number, WindowsProcessRow[]>()
  for (const row of rows) {
    const parentPid = toProcessId(row.ParentProcessId)
    if (parentPid === null) {
      continue
    }
    const siblings = byParent.get(parentPid) ?? []
    siblings.push(row)
    byParent.set(parentPid, siblings)
  }

  const result: WindowsProcessRow[] = []
  const stack = [rootPid]
  const seen = new Set<number>(stack)
  const root = rows.find(row => toProcessId(row.ProcessId) === rootPid)
  if (root) {
    result.push(root)
  }

  while (stack.length > 0) {
    const currentPid = stack.pop()
    if (typeof currentPid !== 'number') {
      continue
    }
    for (const child of byParent.get(currentPid) ?? []) {
      const childPid = toProcessId(child.ProcessId)
      if (childPid === null || seen.has(childPid)) {
        continue
      }
      seen.add(childPid)
      result.push(child)
      stack.push(childPid)
    }
  }

  return result
}

function getCommandLine(row: WindowsProcessRow): string {
  return typeof row.CommandLine === 'string' ? row.CommandLine : ''
}

function getNormalizedCommandLine(row: WindowsProcessRow): string {
  return getCommandLine(row).replace(/\\/g, '/').toLowerCase()
}

function isOpenCoveWorkerRow(row: WindowsProcessRow): boolean {
  const commandLine = getNormalizedCommandLine(row)
  return (
    commandLine.includes('worker.js') &&
    (commandLine.includes('--started-by') ||
      commandLine.includes('--user-data') ||
      commandLine.includes('/out/main/worker.js'))
  )
}

function readWorkerParentPid(row: WindowsProcessRow): number | null {
  if (!isOpenCoveWorkerRow(row)) {
    return null
  }

  const match = WINDOWS_WORKER_PARENT_PID_PATTERN.exec(getCommandLine(row))
  if (!match?.[1]) {
    return null
  }

  return toProcessId(match[1])
}

function collectDescendantRowsForRoots(
  rows: WindowsProcessRow[],
  rootPids: readonly number[],
): WindowsProcessRow[] {
  const byPid = new Map<number, WindowsProcessRow>()
  for (const rootPid of rootPids) {
    for (const row of collectDescendantRows(rows, rootPid)) {
      const pid = toProcessId(row.ProcessId)
      if (pid !== null) {
        byPid.set(pid, row)
      }
    }
  }

  return [...byPid.values()].sort((left, right) => {
    const leftPid = toProcessId(left.ProcessId) ?? 0
    const rightPid = toProcessId(right.ProcessId) ?? 0
    return leftPid - rightPid
  })
}

export function discoverRelatedWindowsRootPids(
  rows: WindowsProcessRow[],
  mainPid: number,
  localWorkerPid: number | null,
): number[] {
  const rootPids = new Set<number>([mainPid])
  if (localWorkerPid !== null && localWorkerPid > 0) {
    rootPids.add(localWorkerPid)
  }

  for (const row of rows) {
    const pid = toProcessId(row.ProcessId)
    if (pid === null) {
      continue
    }

    const workerParentPid = readWorkerParentPid(row)
    if (workerParentPid === mainPid) {
      rootPids.add(pid)
    }
  }

  return [...rootPids]
}

function normalizeWindowsRow(row: WindowsProcessRow): RawPerformanceProcessRow | null {
  const pid = toProcessId(row.ProcessId)
  if (pid === null) {
    return null
  }

  return {
    pid,
    parentPid: toProcessId(row.ParentProcessId),
    name: typeof row.Name === 'string' && row.Name.trim() ? row.Name.trim() : `pid-${pid}`,
    commandLine: getCommandLine(row),
    workingSetBytes: toNonNegativeNumber(row.WorkingSetSize),
    privateBytes: toNonNegativeNumber(row.PrivatePageCount),
    cpuUserTimeMs: toCpuTimeMs(row.UserModeTime),
    cpuKernelTimeMs: toCpuTimeMs(row.KernelModeTime),
    threadCount: toProcessId(row.ThreadCount),
  }
}

async function readWindowsProcessRows(): Promise<WindowsProcessRow[]> {
  const command = [
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount,UserModeTime,KernelModeTime,ThreadCount |',
    'ConvertTo-Json -Compress',
  ].join(' ')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true,
    maxBuffer: WINDOWS_PROCESS_QUERY_MAX_BUFFER_BYTES,
  })
  const text = typeof stdout === 'string' ? stdout.trim() : ''
  if (!text) {
    return []
  }

  return normalizeWindowsRows(JSON.parse(text))
}

async function resolveLocalWorkerPid(): Promise<number | null> {
  try {
    const connection = await resolveControlSurfaceConnectionInfoFromUserData({
      userDataPath: app.getPath('userData'),
      fileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
      requireLivePid: true,
    })
    return connection?.pid ?? null
  } catch {
    return null
  }
}

async function collectWindowsProcessTree(rootPid: number): Promise<{
  status: PerformanceDiagnosticsProcessTreeStatus
  processes: PerformanceDiagnosticsProcess[]
}> {
  const rows = await readWindowsProcessRows()
  const localWorkerPid = await resolveLocalWorkerPid()
  const rootPids = discoverRelatedWindowsRootPids(rows, rootPid, localWorkerPid)
  const descendants = collectDescendantRowsForRoots(rows, rootPids)
  const processes = descendants
    .map(row => normalizeWindowsRow(row))
    .filter((row): row is RawPerformanceProcessRow => row !== null)
    .map(row => normalizePerformanceProcessRow(row, rootPid))
    .filter(row => row.kind !== 'diagnostics-collector')

  return {
    status: {
      status: 'available',
      rootPid,
      sampledProcessCount: processes.length,
      message: null,
    },
    processes,
  }
}

async function collectProcessTree(rootPid: number): Promise<{
  status: PerformanceDiagnosticsProcessTreeStatus
  processes: PerformanceDiagnosticsProcess[]
}> {
  if (process.platform !== 'win32') {
    return {
      status: {
        status: 'unsupported',
        rootPid,
        sampledProcessCount: 0,
        message:
          'Full process-tree attribution is currently implemented for Windows; Electron process metrics are still available.',
      },
      processes: [],
    }
  }

  try {
    return await collectWindowsProcessTree(rootPid)
  } catch (error) {
    return {
      status: {
        status: 'error',
        rootPid,
        sampledProcessCount: 0,
        message: error instanceof Error ? error.message : String(error),
      },
      processes: [],
    }
  }
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function collectElectronMetrics(): PerformanceDiagnosticsElectronMetric[] {
  try {
    return app.getAppMetrics().map(metric => ({
      pid: metric.pid,
      type: metric.type,
      name: metric.name ?? null,
      serviceName: metric.serviceName ?? null,
      cpuPercent: toNullableNumber(metric.cpu.percentCPUUsage),
      memory: {
        workingSetSize: toNullableNumber(metric.memory.workingSetSize),
        peakWorkingSetSize: toNullableNumber(metric.memory.peakWorkingSetSize),
        privateBytes: toNullableNumber(metric.memory.privateBytes),
      },
    }))
  } catch {
    return []
  }
}

function collectSelfProcessFallback(mainPid: number): PerformanceDiagnosticsProcess {
  const memory = process.memoryUsage()
  const resourceUsage = typeof process.resourceUsage === 'function' ? process.resourceUsage() : null
  const argv = process.argv.filter(arg => arg.trim().length > 0)
  return normalizePerformanceProcessRow(
    {
      pid: mainPid,
      parentPid: typeof process.ppid === 'number' && process.ppid > 0 ? process.ppid : null,
      name: basename(process.execPath) || 'OpenCove',
      commandLine: argv.length > 0 ? argv.join(' ') : process.execPath,
      workingSetBytes: Number.isFinite(memory.rss) ? memory.rss : null,
      privateBytes: null,
      cpuUserTimeMs: resourceUsage ? Math.round(resourceUsage.userCPUTime / 1_000) : null,
      cpuKernelTimeMs: resourceUsage ? Math.round(resourceUsage.systemCPUTime / 1_000) : null,
      threadCount: null,
    },
    mainPid,
  )
}

export async function collectPerformanceDiagnosticsSnapshot(): Promise<PerformanceDiagnosticsSnapshotResult> {
  const mainPid = process.pid
  const { status, processes } = await collectProcessTree(mainPid)
  const electronMetrics = collectElectronMetrics()
  const notes: string[] = []
  if (process.platform === 'win32') {
    notes.push('Windows process-tree totals exclude the transient diagnostics collector process.')
  }
  if (status.status !== 'available' && status.message) {
    notes.push(status.message)
  }
  const visibleProcesses =
    processes.length > 0 || electronMetrics.length > 0
      ? processes
      : [collectSelfProcessFallback(mainPid)]
  if (processes.length === 0 && electronMetrics.length === 0) {
    notes.push(SELF_PROCESS_FALLBACK_NOTE)
  }

  return {
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    mainPid,
    processTree: status,
    processes: visibleProcesses,
    processSummary: summarizePerformanceProcesses(visibleProcesses),
    electronMetrics,
    notes,
  }
}
