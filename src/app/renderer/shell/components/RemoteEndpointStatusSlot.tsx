import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { WorkerEndpointOverviewDto } from '@shared/contracts/dto'
import { RemoteEndpointStatusPanel } from './RemoteEndpointStatusPanel'

export function RemoteEndpointStatusSlot({
  t,
  overview,
  busyByEndpointId,
  compact = false,
  showIdentity = true,
  connectedHint = null,
  testIdPrefix,
  onRunAction,
  onReconnect,
}: {
  t: TranslateFn
  overview: WorkerEndpointOverviewDto | null
  busyByEndpointId: Readonly<Record<string, 'prepare' | 'repair'>>
  compact?: boolean
  showIdentity?: boolean
  connectedHint?: string | null
  testIdPrefix: string
  onRunAction: (endpointId: string) => void
  onReconnect: (endpointId: string) => void
}): React.JSX.Element | null {
  if (!overview) {
    return null
  }

  return (
    <RemoteEndpointStatusPanel
      t={t}
      overview={overview}
      isBusy={Boolean(busyByEndpointId[overview.endpoint.endpointId])}
      compact={compact}
      showIdentity={showIdentity}
      connectedHint={connectedHint}
      testIdPrefix={testIdPrefix}
      onRunRecommendedAction={() => {
        onRunAction(overview.endpoint.endpointId)
      }}
      onReconnect={() => {
        onReconnect(overview.endpoint.endpointId)
      }}
    />
  )
}
