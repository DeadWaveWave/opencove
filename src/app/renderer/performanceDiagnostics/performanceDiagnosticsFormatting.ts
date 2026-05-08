import type {
  PerformanceDiagnosticsProcessSummary,
  PerformanceDiagnosticsSnapshotResult,
  PerformanceProcessKind,
  PerformanceProcessScope,
} from '@shared/contracts/dto'
import type {
  RendererDomSnapshot,
  RendererFrameSnapshot,
  RendererMemoryTrendSnapshot,
} from './rendererDiagnosticsSampling'

export type PerformanceStatus = 'sampling' | 'normal' | 'busy' | 'janky' | 'memoryGrowth'

export interface ProcessResourceTotals {
  processCount: number
  workingSetBytes: number | null
  privateBytes: number | null
  threadCount: number | null
  electronCpuPercent: number | null
}

export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }
  if (value < 1024) {
    return `${value} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

export function formatSignedBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }
  if (value === 0) {
    return '0 B'
  }
  return `${value > 0 ? '+' : '-'}${formatBytes(Math.abs(value))}`
}

export function formatMs(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '-' : `${value.toFixed(1)} ms`
}

export function formatInteger(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '-' : String(value)
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

export function getProcessKindLabelKey(kind: PerformanceProcessKind): string {
  return `settingsPanel.diagnostics.processKind.${kind}`
}

export function getProcessScopeLabelKey(scope: PerformanceProcessScope): string {
  return `settingsPanel.diagnostics.scope.${scope}`
}

export function getVisibleProcessSummary(
  snapshot: PerformanceDiagnosticsSnapshotResult | null,
): PerformanceDiagnosticsProcessSummary[] {
  return snapshot?.processSummary.filter(row => row.scope !== 'diagnostics') ?? []
}

export function sortProcessSummaryByMemory(
  rows: PerformanceDiagnosticsProcessSummary[],
): PerformanceDiagnosticsProcessSummary[] {
  return [...rows].sort((left, right) => {
    const leftBytes = Math.max(left.workingSetBytes ?? 0, left.privateBytes ?? 0)
    const rightBytes = Math.max(right.workingSetBytes ?? 0, right.privateBytes ?? 0)
    return rightBytes - leftBytes
  })
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return null
  }
  return left + right
}

export function summarizeProcessResources(
  snapshot: PerformanceDiagnosticsSnapshotResult | null,
): ProcessResourceTotals {
  const rows = getVisibleProcessSummary(snapshot)
  const electronCpuValues = snapshot?.electronMetrics
    .map(metric => metric.cpuPercent)
    .filter((value): value is number => value !== null && Number.isFinite(value))

  return {
    processCount: rows.reduce((total, row) => total + row.count, 0),
    workingSetBytes: rows.reduce<number | null>(
      (total, row) => addNullable(total, row.workingSetBytes),
      0,
    ),
    privateBytes: rows.reduce<number | null>(
      (total, row) => addNullable(total, row.privateBytes),
      0,
    ),
    threadCount: rows.reduce<number | null>((total, row) => addNullable(total, row.threadCount), 0),
    electronCpuPercent:
      electronCpuValues && electronCpuValues.length > 0
        ? electronCpuValues.reduce((total, value) => total + value, 0)
        : null,
  }
}

export function resolvePerformanceStatus({
  frames,
  memoryTrend,
}: {
  frames: RendererFrameSnapshot
  dom: RendererDomSnapshot
  memoryTrend: RendererMemoryTrendSnapshot
}): PerformanceStatus {
  if (memoryTrend.isGrowing) {
    return 'memoryGrowth'
  }
  if (frames.sampleCount < 30 || frames.frameP95Ms === null) {
    return 'sampling'
  }
  if (frames.frameP95Ms >= 33 || (frames.frameMaxMs ?? 0) >= 120) {
    return 'janky'
  }
  if (frames.frameP95Ms >= 20 || (frames.frameMaxMs ?? 0) >= 60) {
    return 'busy'
  }
  return 'normal'
}
