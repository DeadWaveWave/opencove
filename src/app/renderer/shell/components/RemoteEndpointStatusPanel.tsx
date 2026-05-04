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

export function RemoteEndpointStatusPanel({
  t,
  overview,
  isBusy,
  compact = false,
  showIdentity = true,
  connectedHint,
  onRunRecommendedAction,
  onReconnect,
  testIdPrefix,
}: {
  t: TranslateFn
  overview: WorkerEndpointOverviewDto | null
  isBusy: boolean
  compact?: boolean
  showIdentity?: boolean
  connectedHint?: string | null
  onRunRecommendedAction?: (overview: WorkerEndpointOverviewDto) => void
  onReconnect?: (overview: WorkerEndpointOverviewDto) => void
  testIdPrefix?: string
}): React.JSX.Element | null {
  if (!overview) {
    return null
  }

  const tone = getEndpointStatusTone(overview.status)
  const accessLabel = getEndpointAccessLabel(t, overview.endpoint)
  const accessTarget = getEndpointAccessTarget(overview.endpoint)
  const accessLine = accessTarget ? `${accessLabel} · ${accessTarget}` : accessLabel
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
  const shouldShowDiagnostics =
    !compact || tone === 'warning' || tone === 'danger' || tone === 'info'
  const panelClassName = [
    'remote-endpoint-status',
    compact ? 'remote-endpoint-status--compact' : '',
    `remote-endpoint-status--${tone}`,
  ]
    .filter(Boolean)
    .join(' ')
  const badgeClassName = [
    'remote-endpoint-status__badge',
    `remote-endpoint-status__badge--${tone}`,
  ].join(' ')

  return (
    <div
      className={panelClassName}
      data-testid={testIdPrefix ? `${testIdPrefix}-panel` : undefined}
    >
      <div className="remote-endpoint-status__header">
        <div className="remote-endpoint-status__title-group">
          <div className="remote-endpoint-status__title-row">
            {showIdentity ? (
              <strong className="remote-endpoint-status__title">
                {overview.endpoint.displayName}
              </strong>
            ) : null}
            <span className={badgeClassName}>{getEndpointStatusLabel(t, overview.status)}</span>
          </div>
          {showIdentity ? (
            <div className="remote-endpoint-status__meta">{accessLine}</div>
          ) : accessLine ? (
            <div className="remote-endpoint-status__meta">{accessLine}</div>
          ) : null}
          <p className="remote-endpoint-status__summary">{summary}</p>
          {overview.canBrowse && connectedHint ? (
            <div className="remote-endpoint-status__detail">{connectedHint}</div>
          ) : null}
        </div>
      </div>

      {shouldShowDiagnostics && (runtimeLine || details.length > 0) ? (
        <div className="remote-endpoint-status__details">
          {runtimeLine ? <div className="remote-endpoint-status__detail">{runtimeLine}</div> : null}
          {details.map(detail => (
            <div
              key={`${overview.endpoint.endpointId}-detail-${detail}`}
              className="remote-endpoint-status__detail"
            >
              {detail}
            </div>
          ))}
        </div>
      ) : null}

      {showRecommendedAction || onReconnect ? (
        <div className="remote-endpoint-status__actions">
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
        </div>
      ) : null}
    </div>
  )
}