import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkerEndpointOverviewDto } from '@shared/contracts/dto'
import { RemoteEndpointStatusPanel } from './RemoteEndpointStatusPanel'

export function RemoteEndpointStatusSlot({
  t,
  overview,
  busyByEndpointId,
  testIdPrefix,
  onRunAction,
  onReconnect,
  onRefresh,
}: {
  t: TranslateFn
  overview: WorkerEndpointOverviewDto | null
  busyByEndpointId: Readonly<Record<string, 'prepare' | 'repair'>>
  testIdPrefix: string
  onRunAction: (endpointId: string) => void
  onReconnect: (endpointId: string) => void
  onRefresh: () => void
}): React.JSX.Element | null {
  if (!overview) {
    return null
  }

  return (
    <RemoteEndpointStatusPanel
      t={t}
      overview={overview}
      isBusy={Boolean(busyByEndpointId[overview.endpoint.endpointId])}
      connectedHint={t('common.remoteEndpoints.readyHintBrowse')}
      testIdPrefix={testIdPrefix}
      onRunRecommendedAction={() => {
        onRunAction(overview.endpoint.endpointId)
      }}
      onReconnect={() => {
        onReconnect(overview.endpoint.endpointId)
      }}
      onRefresh={onRefresh}
    />
  )
}