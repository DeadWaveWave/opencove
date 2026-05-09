import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  formatBytes,
  formatInteger,
  formatMs,
  formatSignedBytes,
  getDisplayProcessSummary,
  getProcessKindLabelKey,
  getProcessScopeLabelKey,
  isUsingElectronMetricsFallback,
} from '@app/renderer/performanceDiagnostics/performanceDiagnosticsFormatting'
import {
  usePerformanceDiagnosticsSnapshot,
  useRendererDomSampler,
  useRendererFrameSampler,
  useRendererMemoryTrend,
} from '@app/renderer/performanceDiagnostics/rendererDiagnosticsSampling'
import type { PerformanceDiagnosticsProcessSummary } from '@shared/contracts/dto'

export function DiagnosticsSection({
  headerButtonEnabled,
  onChangeHeaderButtonEnabled,
}: {
  headerButtonEnabled: boolean
  onChangeHeaderButtonEnabled: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const copyStatusTimerRef = useRef<number | null>(null)
  const rendererSnapshot = useRendererDomSampler()
  const frameSnapshot = useRendererFrameSampler()
  const memoryTrend = useRendererMemoryTrend(rendererSnapshot)
  const { snapshot, isLoading, isRefreshing, error, refreshSnapshot } =
    usePerformanceDiagnosticsSnapshot({
      enabled: true,
      pollIntervalMs: null,
    })

  useEffect(
    () => () => {
      if (copyStatusTimerRef.current !== null) {
        window.clearTimeout(copyStatusTimerRef.current)
      }
    },
    [],
  )

  const visibleProcessSummary = useMemo(() => getDisplayProcessSummary(snapshot), [snapshot])
  const isElectronMetricsFallback = isUsingElectronMetricsFallback(snapshot)

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
            memoryTrend,
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

      <div className="settings-panel__row">
        <div className="settings-panel__row-label">
          <strong>{t('settingsPanel.diagnostics.headerMonitor.label')}</strong>
          <span>{t('settingsPanel.diagnostics.headerMonitor.help')}</span>
        </div>
        <div className="settings-panel__control">
          <label className="cove-toggle">
            <input
              type="checkbox"
              data-testid="settings-performance-monitor-header-button-enabled"
              checked={headerButtonEnabled}
              onChange={event => onChangeHeaderButtonEnabled(event.target.checked)}
            />
            <span className="cove-toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-panel__diagnostics-actions">
        <button
          type="button"
          className="secondary"
          data-testid="settings-diagnostics-refresh"
          disabled={isLoading || isRefreshing}
          onClick={() => void refreshSnapshot()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {isLoading || isRefreshing
            ? t('settingsPanel.diagnostics.refreshing')
            : t('common.refresh')}
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
          label={t('settingsPanel.diagnostics.metrics.jsHeapDelta')}
          value={formatSignedBytes(memoryTrend.deltaJsHeapUsedBytes)}
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

        <div className="settings-panel__diagnostics-memory-note">
          {snapshot ? (
            <span>
              {t(`settingsPanel.diagnostics.processTreeStatus.${snapshot.processTree.status}`, {
                count: snapshot.processTree.sampledProcessCount,
                message: snapshot.processTree.message,
              })}
            </span>
          ) : null}
          {isElectronMetricsFallback ? (
            <span>{t('settingsPanel.diagnostics.processTreeStatus.electronFallback')}</span>
          ) : null}
          <span>{t('settingsPanel.diagnostics.memoryTerms.workingSet')}</span>
        </div>

        <table className="settings-panel__diagnostics-table">
          <thead>
            <tr>
              <th>{t('settingsPanel.diagnostics.table.kind')}</th>
              <th>{t('settingsPanel.diagnostics.table.scope')}</th>
              <th>{t('settingsPanel.diagnostics.table.count')}</th>
              <th>{t('settingsPanel.diagnostics.table.workingSet')}</th>
              <th>{t('settingsPanel.diagnostics.table.threads')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleProcessSummary.length > 0 ? (
              visibleProcessSummary.map(row => <ProcessSummaryRow key={row.kind} row={row} />)
            ) : !snapshot && !error ? (
              <tr>
                <td colSpan={5}>{t('common.loading')}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan={5}>{t('settingsPanel.diagnostics.noProcessRows')}</td>
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
      <td>{formatBytes(row.workingSetBytes)}</td>
      <td>{formatInteger(row.threadCount)}</td>
    </tr>
  )
}
