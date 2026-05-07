import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  PerformanceDiagnosticsProcessSummary,
  PerformanceDiagnosticsSnapshotResult,
  PerformanceProcessKind,
  PerformanceProcessScope,
} from '@shared/contracts/dto'

interface RendererDomSnapshot {
  domNodeCount: number
  terminalNodeCount: number
  xtermInstanceCount: number
  terminalCanvasCount: number
  jsHeapUsedBytes: number | null
  jsHeapTotalBytes: number | null
}

interface RendererFrameSnapshot {
  sampleCount: number
  frameP95Ms: number | null
  frameMaxMs: number | null
  longTaskCount: number
  longTaskTotalMs: number
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
  }
}

function getRendererDomSnapshot(): RendererDomSnapshot {
  const memory = (window.performance as PerformanceWithMemory).memory
  return {
    domNodeCount: document.querySelectorAll('*').length,
    terminalNodeCount: document.querySelectorAll('.terminal-node').length,
    xtermInstanceCount: document.querySelectorAll('.xterm').length,
    terminalCanvasCount: document.querySelectorAll('.xterm-screen canvas').length,
    jsHeapUsedBytes:
      typeof memory?.usedJSHeapSize === 'number' ? Math.round(memory.usedJSHeapSize) : null,
    jsHeapTotalBytes:
      typeof memory?.totalJSHeapSize === 'number' ? Math.round(memory.totalJSHeapSize) : null,
  }
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index] ?? null
}

function useRendererFrameSampler(): RendererFrameSnapshot {
  const [snapshot, setSnapshot] = useState<RendererFrameSnapshot>({
    sampleCount: 0,
    frameP95Ms: null,
    frameMaxMs: null,
    longTaskCount: 0,
    longTaskTotalMs: 0,
  })

  useEffect(() => {
    const frameDurations: number[] = []
    let animationFrameId = 0
    let lastFrameAt = performance.now()
    let lastPublishAt = lastFrameAt
    let longTaskCount = 0
    let longTaskTotalMs = 0
    let observer: PerformanceObserver | null = null

    const publish = () => {
      setSnapshot({
        sampleCount: frameDurations.length,
        frameP95Ms: percentile(frameDurations, 0.95),
        frameMaxMs: frameDurations.length > 0 ? Math.max(...frameDurations) : null,
        longTaskCount,
        longTaskTotalMs: Math.round(longTaskTotalMs),
      })
    }

    const onFrame = (now: number) => {
      const delta = now - lastFrameAt
      lastFrameAt = now
      if (delta > 0 && delta < 1_000) {
        frameDurations.push(delta)
        if (frameDurations.length > 240) {
          frameDurations.shift()
        }
      }
      if (now - lastPublishAt >= 1_000) {
        lastPublishAt = now
        publish()
      }
      animationFrameId = window.requestAnimationFrame(onFrame)
    }

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            longTaskCount += 1
            longTaskTotalMs += entry.duration
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {
        observer = null
      }
    }

    animationFrameId = window.requestAnimationFrame(onFrame)
    return () => {
      window.cancelAnimationFrame(animationFrameId)
      observer?.disconnect()
    }
  }, [])

  return snapshot
}

function formatBytes(value: number | null): string {
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

function formatMs(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '-' : `${value.toFixed(1)} ms`
}

function formatInteger(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '-' : String(value)
}

function getProcessKindLabelKey(kind: PerformanceProcessKind): string {
  return `settingsPanel.diagnostics.processKind.${kind}`
}

function getProcessScopeLabelKey(scope: PerformanceProcessScope): string {
  return `settingsPanel.diagnostics.scope.${scope}`
}

export function DiagnosticsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<PerformanceDiagnosticsSnapshotResult | null>(null)
  const [rendererSnapshot, setRendererSnapshot] = useState<RendererDomSnapshot>(() =>
    getRendererDomSnapshot(),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const copyStatusTimerRef = useRef<number | null>(null)
  const frameSnapshot = useRendererFrameSampler()

  const refreshSnapshot = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setCopyStatus(null)
    try {
      const nextSnapshot = await window.opencoveApi.performanceDiagnostics.getSnapshot()
      setSnapshot(nextSnapshot)
      setRendererSnapshot(getRendererDomSnapshot())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSnapshot()
  }, [refreshSnapshot])

  useEffect(
    () => () => {
      if (copyStatusTimerRef.current !== null) {
        window.clearTimeout(copyStatusTimerRef.current)
      }
    },
    [],
  )

  const visibleProcessSummary = useMemo(
    () => snapshot?.processSummary.filter(row => row.scope !== 'diagnostics') ?? [],
    [snapshot],
  )

  const copyDiagnostics = async (): Promise<void> => {
    if (!snapshot) {
      return
    }

    await window.opencoveApi.clipboard.writeText(
      JSON.stringify(
        {
          snapshot,
          renderer: {
            dom: rendererSnapshot,
            frames: frameSnapshot,
          },
        },
        null,
        2,
      ),
    )
    setCopyStatus(t('settingsPanel.diagnostics.copied'))
    if (copyStatusTimerRef.current !== null) {
      window.clearTimeout(copyStatusTimerRef.current)
    }
    copyStatusTimerRef.current = window.setTimeout(() => setCopyStatus(null), 2_000)
  }

  return (
    <div className="settings-panel__section" id="settings-section-diagnostics">
      <div className="settings-panel__subsection-header">
        <h3 className="settings-panel__section-title">{t('settingsPanel.diagnostics.title')}</h3>
        <span>{t('settingsPanel.diagnostics.help')}</span>
      </div>

      <div className="settings-panel__diagnostics-actions">
        <button
          type="button"
          className="secondary"
          data-testid="settings-diagnostics-refresh"
          disabled={isLoading}
          onClick={() => void refreshSnapshot()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {isLoading ? t('settingsPanel.diagnostics.refreshing') : t('common.refresh')}
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="settings-diagnostics-copy"
          disabled={!snapshot}
          onClick={() => void copyDiagnostics()}
        >
          <Copy size={14} aria-hidden="true" />
          {t('settingsPanel.diagnostics.copy')}
        </button>
        {copyStatus ? <span className="settings-panel__value">{copyStatus}</span> : null}
      </div>

      {error ? (
        <div className="settings-panel__diagnostics-error" role="status">
          {t('settingsPanel.diagnostics.error', { message: error })}
        </div>
      ) : null}

      <div className="settings-panel__diagnostics-grid">
        <MetricTile
          label={t('settingsPanel.diagnostics.metrics.frameP95')}
          value={formatMs(frameSnapshot.frameP95Ms)}
        />
        <MetricTile
          label={t('settingsPanel.diagnostics.metrics.longTasks')}
          value={formatInteger(frameSnapshot.longTaskCount)}
        />
        <MetricTile
          label={t('settingsPanel.diagnostics.metrics.jsHeap')}
          value={formatBytes(rendererSnapshot.jsHeapUsedBytes)}
        />
        <MetricTile
          label={t('settingsPanel.diagnostics.metrics.domNodes')}
          value={formatInteger(rendererSnapshot.domNodeCount)}
        />
        <MetricTile
          label={t('settingsPanel.diagnostics.metrics.terminals')}
          value={formatInteger(rendererSnapshot.terminalNodeCount)}
        />
        <MetricTile
          label={t('settingsPanel.diagnostics.metrics.xtermInstances')}
          value={formatInteger(rendererSnapshot.xtermInstanceCount)}
        />
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <strong>{t('settingsPanel.diagnostics.processTotals')}</strong>
          <span>
            {snapshot
              ? t('settingsPanel.diagnostics.capturedAt', { time: snapshot.capturedAt })
              : t('common.loading')}
          </span>
        </div>

        <table className="settings-panel__diagnostics-table">
          <thead>
            <tr>
              <th>{t('settingsPanel.diagnostics.table.kind')}</th>
              <th>{t('settingsPanel.diagnostics.table.scope')}</th>
              <th>{t('settingsPanel.diagnostics.table.count')}</th>
              <th>{t('settingsPanel.diagnostics.table.private')}</th>
              <th>{t('settingsPanel.diagnostics.table.workingSet')}</th>
              <th>{t('settingsPanel.diagnostics.table.threads')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleProcessSummary.length > 0 ? (
              visibleProcessSummary.map(row => <ProcessSummaryRow key={row.kind} row={row} />)
            ) : (
              <tr>
                <td colSpan={6}>{t('settingsPanel.diagnostics.noProcessRows')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {snapshot?.notes.length ? (
        <div className="settings-panel__diagnostics-notes">
          {snapshot.notes.map(note => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="settings-panel__diagnostics-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ProcessSummaryRow({
  row,
}: {
  row: PerformanceDiagnosticsProcessSummary
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <tr>
      <td>{t(getProcessKindLabelKey(row.kind))}</td>
      <td>{t(getProcessScopeLabelKey(row.scope))}</td>
      <td>{row.count}</td>
      <td>{formatBytes(row.privateBytes)}</td>
      <td>{formatBytes(row.workingSetBytes)}</td>
      <td>{formatInteger(row.threadCount)}</td>
    </tr>
  )
}
