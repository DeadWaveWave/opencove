import { useEffect, useRef, useState } from 'react'
import type { PerformanceDiagnosticsSnapshotResult } from '@shared/contracts/dto'
import {
  getDisplayProcessSummary,
  sortProcessSummaryByMemory,
  summarizeProcessResources,
  type PerformanceStatus,
} from './performanceDiagnosticsFormatting'
import type {
  RendererDomSnapshot,
  RendererFrameSnapshot,
  RendererMemoryTrendSnapshot,
} from './rendererDiagnosticsSampling'

export type PerformanceIncidentTrigger = 'frameJank' | 'longTask' | 'memoryGrowth'

export interface PerformanceIncident {
  id: string
  capturedAt: string
  trigger: PerformanceIncidentTrigger
  status: PerformanceStatus
  frameP95Ms: number | null
  frameMaxMs: number | null
  longTaskCount: number
  longTaskTotalMs: number
  longTaskDeltaCount: number
  longTaskDeltaMs: number
  jsHeapUsedBytes: number | null
  jsHeapDeltaBytes: number | null
  domNodeCount: number
  terminalNodeCount: number
  xtermInstanceCount: number
  processSnapshot: PerformanceDiagnosticsSnapshotResult | null
  processSnapshotError: string | null
}

export interface PerformanceIncidentDecisionInput {
  status: PerformanceStatus
  frames: RendererFrameSnapshot
  memoryTrend: RendererMemoryTrendSnapshot
  previousLongTaskCount: number
  previousLongTaskTotalMs: number
  lastRecordedAtMs: number
  nowMs: number
  cooldownMs: number
}

const MAX_INCIDENTS = 8
const INCIDENT_COOLDOWN_MS = 15_000

function createIncidentId(capturedAt: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `performance-incident-${capturedAt}-${Math.random().toString(16).slice(2)}`
}

function roundMetric(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10
}

export function resolvePerformanceIncidentTrigger({
  status,
  frames,
  memoryTrend,
  previousLongTaskCount,
  previousLongTaskTotalMs,
  lastRecordedAtMs,
  nowMs,
  cooldownMs,
}: PerformanceIncidentDecisionInput): PerformanceIncidentTrigger | null {
  if (nowMs - lastRecordedAtMs < cooldownMs) {
    return null
  }

  if (memoryTrend.isGrowing || status === 'memoryGrowth') {
    return 'memoryGrowth'
  }

  if (status === 'janky') {
    return 'frameJank'
  }

  const longTaskDeltaCount = Math.max(0, frames.longTaskCount - previousLongTaskCount)
  const longTaskDeltaMs = Math.max(0, frames.longTaskTotalMs - previousLongTaskTotalMs)
  if (longTaskDeltaCount > 0 && longTaskDeltaMs >= 50) {
    return 'longTask'
  }

  return null
}

function toLogDetails(
  incident: PerformanceIncident,
  snapshot?: PerformanceDiagnosticsSnapshotResult | null,
) {
  const rows = sortProcessSummaryByMemory(getDisplayProcessSummary(snapshot ?? null))
  const totals = summarizeProcessResources(snapshot ?? null)
  const topProcess = rows[0] ?? null

  return {
    trigger: incident.trigger,
    status: incident.status,
    frameP95Ms: incident.frameP95Ms,
    frameMaxMs: incident.frameMaxMs,
    longTaskDeltaCount: incident.longTaskDeltaCount,
    longTaskDeltaMs: incident.longTaskDeltaMs,
    jsHeapUsedBytes: incident.jsHeapUsedBytes,
    jsHeapDeltaBytes: incident.jsHeapDeltaBytes,
    domNodeCount: incident.domNodeCount,
    terminalNodeCount: incident.terminalNodeCount,
    xtermInstanceCount: incident.xtermInstanceCount,
    processTreeStatus: snapshot?.processTree.status ?? null,
    processCount: totals.processCount,
    processWorkingSetBytes: totals.workingSetBytes,
    processReservedBytes: totals.privateBytes,
    topProcessKind: topProcess?.kind ?? null,
    topProcessWorkingSetBytes: topProcess?.workingSetBytes ?? null,
  }
}

function logIncident(
  event: string,
  message: string,
  incident: PerformanceIncident,
  snapshot?: PerformanceDiagnosticsSnapshotResult | null,
): void {
  window.opencoveApi.debug?.logRuntimeDiagnostics?.({
    source: 'renderer-performance-monitor',
    level: 'info',
    event,
    message,
    details: toLogDetails(incident, snapshot),
  })
}

export function usePerformanceIncidentRecorder({
  status,
  frameSnapshot,
  rendererSnapshot,
  memoryTrend,
}: {
  status: PerformanceStatus
  frameSnapshot: RendererFrameSnapshot
  rendererSnapshot: RendererDomSnapshot
  memoryTrend: RendererMemoryTrendSnapshot
}): PerformanceIncident[] {
  const [incidents, setIncidents] = useState<PerformanceIncident[]>([])
  const mountedRef = useRef(true)
  const lastRecordedAtRef = useRef(0)
  const previousLongTaskRef = useRef<{ count: number; totalMs: number } | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const previousLongTask = previousLongTaskRef.current
    previousLongTaskRef.current = {
      count: frameSnapshot.longTaskCount,
      totalMs: frameSnapshot.longTaskTotalMs,
    }

    if (previousLongTask === null) {
      return
    }

    const nowMs = performance.now()
    const trigger = resolvePerformanceIncidentTrigger({
      status,
      frames: frameSnapshot,
      memoryTrend,
      previousLongTaskCount: previousLongTask.count,
      previousLongTaskTotalMs: previousLongTask.totalMs,
      lastRecordedAtMs: lastRecordedAtRef.current,
      nowMs,
      cooldownMs: INCIDENT_COOLDOWN_MS,
    })

    if (trigger === null) {
      return
    }

    lastRecordedAtRef.current = nowMs
    const capturedAt = new Date().toISOString()
    const incident: PerformanceIncident = {
      id: createIncidentId(capturedAt),
      capturedAt,
      trigger,
      status,
      frameP95Ms: roundMetric(frameSnapshot.frameP95Ms),
      frameMaxMs: roundMetric(frameSnapshot.frameMaxMs),
      longTaskCount: frameSnapshot.longTaskCount,
      longTaskTotalMs: frameSnapshot.longTaskTotalMs,
      longTaskDeltaCount: Math.max(0, frameSnapshot.longTaskCount - previousLongTask.count),
      longTaskDeltaMs: Math.max(0, frameSnapshot.longTaskTotalMs - previousLongTask.totalMs),
      jsHeapUsedBytes: rendererSnapshot.jsHeapUsedBytes,
      jsHeapDeltaBytes: memoryTrend.deltaJsHeapUsedBytes,
      domNodeCount: rendererSnapshot.domNodeCount,
      terminalNodeCount: rendererSnapshot.terminalNodeCount,
      xtermInstanceCount: rendererSnapshot.xtermInstanceCount,
      processSnapshot: null,
      processSnapshotError: null,
    }

    setIncidents(current => [incident, ...current].slice(0, MAX_INCIDENTS))
    logIncident('performance-incident', 'Renderer performance incident recorded.', incident)

    void window.opencoveApi.performanceDiagnostics
      .getSnapshot()
      .then(snapshot => {
        if (!mountedRef.current) {
          return
        }
        setIncidents(current =>
          current.map(item =>
            item.id === incident.id ? { ...item, processSnapshot: snapshot } : item,
          ),
        )
        logIncident(
          'performance-incident-process-snapshot',
          'Process snapshot attached to renderer performance incident.',
          incident,
          snapshot,
        )
      })
      .catch(error => {
        if (!mountedRef.current) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setIncidents(current =>
          current.map(item =>
            item.id === incident.id ? { ...item, processSnapshotError: message } : item,
          ),
        )
      })
  }, [frameSnapshot, memoryTrend, rendererSnapshot, status])

  return incidents
}
