import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, Copy, RefreshCw, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  formatBytes,
  formatInteger,
  formatMs,
  formatPercent,
  formatSignedBytes,
  getDisplayProcessSummary,
  getProcessKindLabelKey,
  getProcessScopeLabelKey,
  isUsingElectronMetricsFallback,
  sortProcessSummaryByMemory,
  summarizeProcessResources,
  type PerformanceStatus,
} from '@app/renderer/performanceDiagnostics/performanceDiagnosticsFormatting'
import {
  usePerformanceDiagnosticsSnapshot,
  type RendererDomSnapshot,
  type RendererFrameSnapshot,
  type RendererMemoryTrendSnapshot,
} from '@app/renderer/performanceDiagnostics/rendererDiagnosticsSampling'
import type { PerformanceIncident } from '@app/renderer/performanceDiagnostics/performanceIncidentRecorder'
import type { PerformanceDiagnosticsProcessSummary } from '@shared/contracts/dto'

const PROCESS_POLL_INTERVAL_MS = 5_000
const COPY_STATUS_DURATION_MS = 2_000

export function PerformanceMonitorPanel({
  isOpen,
  status,
  frameSnapshot,
  rendererSnapshot,
  memoryTrend,
  incidents,
  onClose,
}: {
  isOpen: boolean
  status: PerformanceStatus
  frameSnapshot: RendererFrameSnapshot
  rendererSnapshot: RendererDomSnapshot
  memoryTrend: RendererMemoryTrendSnapshot
  incidents: PerformanceIncident[]
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const copyStatusTimerRef = useRef<number | null>(null)
  const { snapshot, isLoading, isRefreshing, error, refreshSnapshot } =
    usePerformanceDiagnosticsSnapshot({
      enabled: isOpen,
      pollIntervalMs: PROCESS_POLL_INTERVAL_MS,
    })

  const statusLabel = t(`performanceMonitor.status.${status}`)
  const visibleRows = useMemo(
    () => sortProcessSummaryByMemory(getDisplayProcessSummary(snapshot)).slice(0, 6),
    [snapshot],
  )
  const processTotals = useMemo(() => summarizeProcessResources(snapshot), [snapshot])
  const isElectronMetricsFallback = isUsingElectronMetricsFallback(snapshot)

  useEffect(() => {
    if (!isOpen) {
      setCopyStatus(null)
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  useEffect(
    () => () => {
      if (copyStatusTimerRef.current !== null) {
        window.clearTimeout(copyStatusTimerRef.current)
      }
    },
    [],
  )

  if (!isOpen || typeof document === 'undefined' || !document.body) {
    return null
  }

  const copyReport = async (): Promise<void> => {
    await window.opencoveApi.clipboard.writeText(
      JSON.stringify(
        {
          snapshot,
          renderer: {
            dom: rendererSnapshot,
            frames: frameSnapshot,
            memoryTrend,
            status,
          },
          processTotals,
          incidents,
        },
        null,
        2,
      ),
    )
    setCopyStatus(t('performanceMonitor.copied'))
    if (copyStatusTimerRef.current !== null) {
      window.clearTimeout(copyStatusTimerRef.current)
    }
    copyStatusTimerRef.current = window.setTimeout(
      () => setCopyStatus(null),
      COPY_STATUS_DURATION_MS,
    )
  }

  return createPortal(
    <section
      className="performance-monitor"
      data-status={status}
      data-testid="performance-monitor-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="performance-monitor-title"
    >
      <header className="performance-monitor__header">
        <div className="performance-monitor__title-group">
          <div className="performance-monitor__title-row">
            <Activity aria-hidden="true" size={16} />
            <h3 id="performance-monitor-title">{t('performanceMonitor.title')}</h3>
            <span className="performance-monitor__status">{statusLabel}</span>
            <span className="performance-monitor__live">{t('performanceMonitor.live')}</span>
          </div>
          <span className="performance-monitor__meta">
            {snapshot
              ? t('performanceMonitor.updatedAt', { time: snapshot.capturedAt })
              : t('performanceMonitor.waitingForProcessSnapshot')}
          </span>
        </div>

        <div className="performance-monitor__actions">
          {copyStatus ? (
            <span className="performance-monitor__copy-status">{copyStatus}</span>
          ) : null}
          <button
            type="button"
            className="performance-monitor__icon-button"
            data-testid="performance-monitor-refresh"
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            disabled={isLoading || isRefreshing}
            onClick={() => void refreshSnapshot()}
          >
            <RefreshCw aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            className="performance-monitor__icon-button"
            data-testid="performance-monitor-copy"
            aria-label={t('performanceMonitor.copy')}
            title={t('performanceMonitor.copy')}
            onClick={() => void copyReport()}
          >
            <Copy aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            className="performance-monitor__icon-button"
            data-testid="performance-monitor-close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="performance-monitor__error" role="status">
          {t('performanceMonitor.error', { message: error })}
        </div>
      ) : null}

      <PerformanceSection title={t('performanceMonitor.sections.renderer')}>
        <MetricTile
          label={t('performanceMonitor.metrics.frameP95')}
          value={formatMs(frameSnapshot.frameP95Ms)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.frameMax')}
          value={formatMs(frameSnapshot.frameMaxMs)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.longTasks')}
          value={formatInteger(frameSnapshot.longTaskCount)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.jsHeap')}
          value={formatBytes(rendererSnapshot.jsHeapUsedBytes)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.jsHeapDelta')}
          value={formatSignedBytes(memoryTrend.deltaJsHeapUsedBytes)}
          tone={memoryTrend.isGrowing ? 'warning' : 'default'}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.domNodes')}
          value={formatInteger(rendererSnapshot.domNodeCount)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.terminals')}
          value={formatInteger(rendererSnapshot.terminalNodeCount)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.xtermInstances')}
          value={formatInteger(rendererSnapshot.xtermInstanceCount)}
        />
      </PerformanceSection>

      <PerformanceSection title={t('performanceMonitor.sections.processes')}>
        <MetricTile
          label={t('performanceMonitor.metrics.electronCpu')}
          value={formatPercent(processTotals.electronCpuPercent)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.memoryInUse')}
          value={formatBytes(processTotals.workingSetBytes)}
        />
        <MetricTile
          label={t('performanceMonitor.metrics.threads')}
          value={formatInteger(processTotals.threadCount)}
        />
      </PerformanceSection>

      <p className="performance-monitor__memory-help">{t('performanceMonitor.memoryHelp')}</p>

      <div className="performance-monitor__process-status">
        {snapshot ? (
          <span>
            {t(`performanceMonitor.processTreeStatus.${snapshot.processTree.status}`, {
              count: snapshot.processTree.sampledProcessCount,
              message: snapshot.processTree.message,
            })}
          </span>
        ) : null}
        {isElectronMetricsFallback ? (
          <span>{t('performanceMonitor.processTreeStatus.electronFallback')}</span>
        ) : null}
        {snapshot?.notes.map(note => (
          <span key={note}>{note}</span>
        ))}
      </div>

      <section className="performance-monitor__section" data-testid="performance-monitor-incidents">
        <div className="performance-monitor__section-header">
          <div className="performance-monitor__section-title">
            {t('performanceMonitor.sections.incidents')}
          </div>
          <span>{t('performanceMonitor.incidents.recentLimit')}</span>
        </div>
        {incidents.length > 0 ? (
          <div className="performance-monitor__incident-list">
            {incidents.map(incident => (
              <IncidentRow key={incident.id} incident={incident} />
            ))}
          </div>
        ) : (
          <p className="performance-monitor__incident-empty">
            {t('performanceMonitor.incidents.empty')}
          </p>
        )}
      </section>

      <table className="performance-monitor__table">
        <thead>
          <tr>
            <th>{t('performanceMonitor.table.kind')}</th>
            <th>{t('performanceMonitor.table.scope')}</th>
            <th>{t('performanceMonitor.table.count')}</th>
            <th>{t('performanceMonitor.table.memoryInUse')}</th>
            <th>{t('performanceMonitor.table.threads')}</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length > 0 ? (
            visibleRows.map(row => <ProcessSummaryRow key={row.kind} row={row} />)
          ) : !snapshot && !error ? (
            <tr>
              <td colSpan={5}>{t('common.loading')}</td>
            </tr>
          ) : (
            <tr>
              <td colSpan={5}>{t('performanceMonitor.noProcessRows')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>,
    document.body,
  )
}

function IncidentRow({ incident }: { incident: PerformanceIncident }): React.JSX.Element {
  const { t } = useTranslation()
  const processRows = incident.processSnapshot
    ? sortProcessSummaryByMemory(getDisplayProcessSummary(incident.processSnapshot))
    : []
  const topProcess = processRows[0] ?? null
  return (
    <div className="performance-monitor__incident-row">
      <div>
        <strong>{t(`performanceMonitor.incidents.trigger.${incident.trigger}`)}</strong>
        <span>{incident.capturedAt}</span>
      </div>
      <div>
        <span>{formatMs(incident.frameP95Ms)}</span>
        <span>{formatBytes(incident.jsHeapUsedBytes)}</span>
        <span>{topProcess ? t(getProcessKindLabelKey(topProcess.kind)) : '-'}</span>
      </div>
    </div>
  )
}

function PerformanceSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="performance-monitor__section">
      <div className="performance-monitor__section-title">{title}</div>
      <div className="performance-monitor__metric-grid">{children}</div>
    </section>
  )
}

function MetricTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'warning'
}): React.JSX.Element {
  return (
    <div className="performance-monitor__metric" data-tone={tone}>
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
      <td>{formatBytes(row.workingSetBytes)}</td>
      <td>{formatInteger(row.threadCount)}</td>
    </tr>
  )
}
