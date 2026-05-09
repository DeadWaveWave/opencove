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
import {
  collectDescendantRawRowsForRoots,
  discoverRelatedProcessRootPids,
} from './performanceProcessTreeHelpers'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../../shared/constants/controlSurface'

const execFileAsync = promisify(execFile)
const PROCESS_QUERY_MAX_BUFFER_BYTES = 20 * 1024 * 1024
const SELF_PROCESS_FALLBACK_NOTE =
  'Process-tree rows were unavailable; showing the current OpenCove main process as a fallback.'
const UNIX_PS_QUERY_ARGUMENTS: Record<'darwin' | 'linux', string[]> = {
  darwin: ['-ww', '-axo', 'pid=,ppid=,rss=,ucomm=,args='],
  linux: ['-ww', '-axo', 'pid=,ppid=,rss=,nlwp=,comm=,args='],
}

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

function kibToBytes(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1024)
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
  return discoverRelatedProcessRootPids(
    rows
      .map(row => {
        const pid = toProcessId(row.ProcessId)
        return pid === null
          ? null
          : {
              pid,
              commandLine: getCommandLine(row),
            }
      })
      .filter(
        (
          row,
        ): row is {
          pid: number
          commandLine: string
        } => row !== null,
      ),
    mainPid,
    localWorkerPid,
  )
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
    maxBuffer: PROCESS_QUERY_MAX_BUFFER_BYTES,
  })
  const text = typeof stdout === 'string' ? stdout.trim() : ''
  if (!text) {
    return []
  }

  return normalizeWindowsRows(JSON.parse(text))
}

function normalizeUnixProcessLine(
  line: string,
  platform: 'darwin' | 'linux',
): RawPerformanceProcessRow | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  const pattern =
    platform === 'darwin'
      ? /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/
      : /^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/
  const match = pattern.exec(trimmed)
  if (!match) {
    return null
  }

  const pid = toProcessId(match[1])
  if (pid === null) {
    return null
  }

  const threadCount = platform === 'linux' ? toProcessId(match[4]) : null
  const name = platform === 'linux' ? match[5] : match[4]
  const commandLine =
    platform === 'linux'
      ? match[6]?.trim() || match[5] || `pid-${pid}`
      : match[5]?.trim() || match[4] || `pid-${pid}`
  return {
    pid,
    parentPid: toProcessId(match[2]),
    name: name || `pid-${pid}`,
    commandLine,
    workingSetBytes: kibToBytes(toNonNegativeNumber(match[3])),
    privateBytes: null,
    cpuUserTimeMs: null,
    cpuKernelTimeMs: null,
    threadCount,
  }
}

async function readUnixProcessRows(
  platform: 'darwin' | 'linux',
): Promise<RawPerformanceProcessRow[]> {
  const { stdout } = await execFileAsync('ps', UNIX_PS_QUERY_ARGUMENTS[platform], {
    maxBuffer: PROCESS_QUERY_MAX_BUFFER_BYTES,
  })
  const text = typeof stdout === 'string' ? stdout : ''
  return text
    .split(/\r?\n/)
    .map(line => normalizeUnixProcessLine(line, platform))
    .filter((row): row is RawPerformanceProcessRow => row !== null)
}

function countDarwinThreadsByPid(text: string): Map<number, number> {
  const counts = new Map<number, number>()
  for (const line of text.split(/\r?\n/)) {
    const pidToken = line
      .trim()
      .split(/\s+/)
      .find(token => /^\d+$/.test(token))
    const pid = toProcessId(pidToken)
    if (pid === null) {
      continue
    }
    counts.set(pid, (counts.get(pid) ?? 0) + 1)
  }
  return counts
}

async function readDarwinThreadCounts(pids: readonly number[]): Promise<Map<number, number>> {
  if (pids.length === 0) {
    return new Map()
  }
  const { stdout } = await execFileAsync('ps', ['-M', '-p', pids.join(',')], {
    maxBuffer: PROCESS_QUERY_MAX_BUFFER_BYTES,
  })
  return countDarwinThreadsByPid(typeof stdout === 'string' ? stdout : '')
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

async function collectUnixProcessTree(
  rootPid: number,
  platform: 'darwin' | 'linux',
): Promise<{
  status: PerformanceDiagnosticsProcessTreeStatus
  processes: PerformanceDiagnosticsProcess[]
}> {
  const rows = await readUnixProcessRows(platform)
  const localWorkerPid = await resolveLocalWorkerPid()
  const rootPids = discoverRelatedProcessRootPids(rows, rootPid, localWorkerPid)
  let descendants = collectDescendantRawRowsForRoots(rows, rootPids)
  if (platform === 'darwin') {
    const threadCounts = await readDarwinThreadCounts(descendants.map(row => row.pid))
    descendants = descendants.map(row => ({
      ...row,
      threadCount: threadCounts.get(row.pid) ?? null,
    }))
  }
  const processes = descendants
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
  try {
    if (process.platform === 'win32') {
      return await collectWindowsProcessTree(rootPid)
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      return await collectUnixProcessTree(rootPid, process.platform)
    }

    return {
      status: {
        status: 'unsupported',
        rootPid,
        sampledProcessCount: 0,
        message: `Full process-tree attribution is not implemented for ${process.platform}. Electron process metrics are still available.`,
      },
      processes: [],
    }
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
