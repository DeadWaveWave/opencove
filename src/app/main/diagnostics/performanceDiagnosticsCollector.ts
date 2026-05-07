import { execFile } from 'node:child_process'
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

const execFileAsync = promisify(execFile)
const WINDOWS_PROCESS_QUERY_MAX_BUFFER_BYTES = 20 * 1024 * 1024

interface WindowsProcessRow {
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

function collectDescendantRows(rows: WindowsProcessRow[], rootPid: number): WindowsProcessRow[] {
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

function normalizeWindowsRow(row: WindowsProcessRow): RawPerformanceProcessRow | null {
  const pid = toProcessId(row.ProcessId)
  if (pid === null) {
    return null
  }

  return {
    pid,
    parentPid: toProcessId(row.ParentProcessId),
    name: typeof row.Name === 'string' && row.Name.trim() ? row.Name.trim() : `pid-${pid}`,
    commandLine: typeof row.CommandLine === 'string' ? row.CommandLine : '',
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

async function collectWindowsProcessTree(rootPid: number): Promise<{
  status: PerformanceDiagnosticsProcessTreeStatus
  processes: PerformanceDiagnosticsProcess[]
}> {
  const rows = await readWindowsProcessRows()
  const descendants = collectDescendantRows(rows, rootPid)
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

export async function collectPerformanceDiagnosticsSnapshot(): Promise<PerformanceDiagnosticsSnapshotResult> {
  const mainPid = process.pid
  const { status, processes } = await collectProcessTree(mainPid)
  const notes: string[] = []
  if (process.platform === 'win32') {
    notes.push('Windows process-tree totals exclude the transient diagnostics collector process.')
  }
  if (status.status !== 'available' && status.message) {
    notes.push(status.message)
  }

  return {
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    mainPid,
    processTree: status,
    processes,
    processSummary: summarizePerformanceProcesses(processes),
    electronMetrics: collectElectronMetrics(),
    notes,
  }
}
