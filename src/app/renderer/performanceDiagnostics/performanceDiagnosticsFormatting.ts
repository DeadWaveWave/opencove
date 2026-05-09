import type {
  PerformanceDiagnosticsElectronMetric,
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

const KIB_BYTES = 1024

function electronMetricMemoryToBytes(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * KIB_BYTES)
}

function resolveElectronMetricKind(
  metric: PerformanceDiagnosticsElectronMetric,
): PerformanceProcessKind {
  const type = metric.type.toLowerCase()
  const label = `${metric.name ?? ''} ${metric.serviceName ?? ''}`.toLowerCase()

  if (type === 'browser') {
    return 'opencove-main'
  }
  if (type === 'tab' || type === 'renderer' || label.includes('renderer')) {
    return 'opencove-renderer'
  }
  if (type === 'utility' || type === 'gpu' || label.includes('utility')) {
    return 'opencove-utility'
  }
  return 'other'
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

export function summarizeElectronMetrics(
  snapshot: PerformanceDiagnosticsSnapshotResult | null,
): PerformanceDiagnosticsProcessSummary[] {
  if (!snapshot || snapshot.electronMetrics.length === 0) {
    return []
  }

  const rows = new Map<PerformanceProcessKind, PerformanceDiagnosticsProcessSummary>()
  for (const metric of snapshot.electronMetrics) {
    const kind = resolveElectronMetricKind(metric)
    const existing = rows.get(kind) ?? {
      kind,
      scope: kind === 'other' ? 'other' : 'opencove',
      count: 0,
      workingSetBytes: 0,
      privateBytes: 0,
      threadCount: null,
    }
    existing.count += 1
    existing.workingSetBytes = addNullable(
      existing.workingSetBytes,
      electronMetricMemoryToBytes(metric.memory.workingSetSize),
    )
    existing.privateBytes = addNullable(
      existing.privateBytes,
      electronMetricMemoryToBytes(metric.memory.privateBytes),
    )
    rows.set(kind, existing)
  }

  return [...rows.values()].sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.kind.localeCompare(b.kind),
  )
}

export function isUsingElectronMetricsFallback(
  snapshot: PerformanceDiagnosticsSnapshotResult | null,
): boolean {
  return (
    getVisibleProcessSummary(snapshot).length === 0 && summarizeElectronMetrics(snapshot).length > 0
  )
}

export function getDisplayProcessSummary(
  snapshot: PerformanceDiagnosticsSnapshotResult | null,
): PerformanceDiagnosticsProcessSummary[] {
  const processTreeRows = getVisibleProcessSummary(snapshot)
  return processTreeRows.length > 0 ? processTreeRows : summarizeElectronMetrics(snapshot)
}

export function sortProcessSummaryByMemory(
  rows: PerformanceDiagnosticsProcessSummary[],
): PerformanceDiagnosticsProcessSummary[] {
  return [...rows].sort((left, right) => {
    const leftBytes = left.workingSetBytes ?? 0
    const rightBytes = right.workingSetBytes ?? 0
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
  const rows = getDisplayProcessSummary(snapshot)
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
