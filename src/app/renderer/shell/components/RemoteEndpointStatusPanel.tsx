import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkerEndpointOverviewDto } from '@shared/contracts/dto'
import {
  getEndpointAccessLabel,
  getEndpointAccessTarget,
  getEndpointActionExecution,
  getEndpointActionLabel,
  getEndpointStatusLabel,
  getEndpointStatusSummary,
  getEndpointStatusTone,
  getEndpointTechnicalDetails,
} from '../utils/endpointOverviewUi'

function resolveToneStyles(status: WorkerEndpointOverviewDto['status']): {
  border: string
  background: string
  color: string
} {
  switch (getEndpointStatusTone(status)) {
    case 'success':
      return {
        border: 'rgba(88, 197, 122, 0.28)',
        background: 'rgba(88, 197, 122, 0.12)',
        color: 'var(--cove-text)',
      }
    case 'info':
      return {
        border: 'rgba(94, 156, 255, 0.26)',
        background: 'rgba(94, 156, 255, 0.12)',
        color: 'var(--cove-text)',
      }
    case 'warning':
      return {
        border: 'var(--cove-overlay-warning-pill-border)',
        background: 'var(--cove-overlay-warning-pill-surface)',
        color: 'var(--cove-text)',
      }
    case 'danger':
      return {
        border: 'var(--cove-overlay-danger-status-border)',
        background: 'var(--cove-overlay-danger-status-surface)',
        color: 'var(--cove-overlay-danger-status-text)',
      }
    case 'neutral':
    default:
      return {
        border: 'var(--cove-border-subtle)',
        background: 'var(--cove-surface-hover)',
        color: 'var(--cove-text)',
      }
  }
}

export function RemoteEndpointStatusPanel({
  t,
  overview,
  isBusy,
  connectedHint,
  onRunRecommendedAction,
  onReconnect,
  onRefresh,
  testIdPrefix,
}: {
  t: TranslateFn
  overview: WorkerEndpointOverviewDto | null
  isBusy: boolean
  connectedHint?: string | null
  onRunRecommendedAction?: (overview: WorkerEndpointOverviewDto) => void
  onReconnect?: (overview: WorkerEndpointOverviewDto) => void
  onRefresh?: () => void
  testIdPrefix?: string
}): React.JSX.Element | null {
  if (!overview) {
    return null
  }

  const tone = resolveToneStyles(overview.status)
  const accessLabel = getEndpointAccessLabel(t, overview.endpoint)
  const accessTarget = getEndpointAccessTarget(overview.endpoint)
  const summary = getEndpointStatusSummary(t, overview)
  const details = getEndpointTechnicalDetails(overview)
  const runtimeLine =
    overview.runtime.appVersion || overview.runtime.protocolVersion !== null
      ? [
          overview.runtime.appVersion
            ? t('common.remoteEndpoints.runtimeVersion', {
                version: overview.runtime.appVersion,
              })
            : null,
          overview.runtime.protocolVersion !== null
            ? t('common.remoteEndpoints.protocolVersion', {
                version: String(overview.runtime.protocolVersion),
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null
  const recommendedAction = getEndpointActionExecution(overview.recommendedAction)
  const showRecommendedAction =
    recommendedAction !== null &&
    overview.recommendedAction !== 'browse' &&
    overview.recommendedAction !== 'show_details'

  return (
    <div
      style={{
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        borderRadius: 12,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      data-testid={testIdPrefix ? `${testIdPrefix}-panel` : undefined}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong>{overview.endpoint.displayName}</strong>
          <span
            style={{
              border: `1px solid ${tone.border}`,
              background: tone.background,
              color: tone.color,
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 11,
            }}
          >
            {getEndpointStatusLabel(t, overview.status)}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>
          {accessTarget ? `${accessLabel} · ${accessTarget}` : accessLabel}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 13 }}>{summary}</div>
        {overview.canBrowse && connectedHint ? (
          <div style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>{connectedHint}</div>
        ) : null}
        {runtimeLine ? (
          <div style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}>{runtimeLine}</div>
        ) : null}
        {details.map(detail => (
          <div
            key={`${overview.endpoint.endpointId}-detail-${detail}`}
            style={{ fontSize: 12, color: 'var(--cove-text-muted)' }}
          >
            {detail}
          </div>
        ))}
      </div>

      {showRecommendedAction || onReconnect || onRefresh ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {showRecommendedAction && onRunRecommendedAction ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--primary"
              disabled={isBusy}
              data-testid={testIdPrefix ? `${testIdPrefix}-recommended-action` : undefined}
              onClick={() => onRunRecommendedAction(overview)}
            >
              {getEndpointActionLabel(t, overview.recommendedAction)}
            </button>
          ) : null}
          {overview.isManaged && onReconnect ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isBusy}
              data-testid={testIdPrefix ? `${testIdPrefix}-reconnect` : undefined}
              onClick={() => onReconnect(overview)}
            >
              {t('common.remoteEndpoints.action.reconnect')}
            </button>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--ghost"
              disabled={isBusy}
              data-testid={testIdPrefix ? `${testIdPrefix}-refresh` : undefined}
              onClick={() => onRefresh()}
            >
              {t('common.refresh')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}