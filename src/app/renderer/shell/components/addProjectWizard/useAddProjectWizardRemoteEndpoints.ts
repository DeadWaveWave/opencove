import { useCallback, useEffect, useMemo } from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import { useEndpointOverviews } from '../../hooks/useEndpointOverviews'
import { toErrorMessage } from '../../utils/format'
import { getEndpointActionExecution, getEndpointStatusLabel } from '../../utils/endpointOverviewUi'

export function useAddProjectWizardRemoteEndpoints({
  remoteWorkersEnabled,
  t,
  defaultRemoteEndpointId,
  setDefaultRemoteEndpointId,
  extraRemoteEndpointId,
  setExtraRemoteEndpointId,
  setError,
}: {
  remoteWorkersEnabled: boolean
  t: TranslateFn
  defaultRemoteEndpointId: string
  setDefaultRemoteEndpointId: (value: string) => void
  extraRemoteEndpointId: string
  setExtraRemoteEndpointId: (value: string) => void
  setError: (value: string | null) => void
}) {
  const {
    remoteOverviews,
    overviewByEndpointId,
    error: endpointError,
    busyByEndpointId,
    reload,
    prepareEndpoint,
    repairEndpoint,
  } = useEndpointOverviews({ enabled: remoteWorkersEnabled })

  const endpointLabelById = useMemo(() => {
    const map = new Map<string, string>()
    map.set('local', 'Local')
    for (const overview of remoteOverviews) {
      map.set(overview.endpoint.endpointId, overview.endpoint.displayName)
    }
    return map
  }, [remoteOverviews])

  const endpointOptions = useMemo(
    () =>
      remoteOverviews.map(overview => ({
        value: overview.endpoint.endpointId,
        label: overview.endpoint.displayName,
        badge: getEndpointStatusLabel(t, overview.status),
      })),
    [remoteOverviews, t],
  )

  useEffect(() => {
    if (!remoteWorkersEnabled) {
      setDefaultRemoteEndpointId('')
      setExtraRemoteEndpointId('')
      return
    }

    const resolveEndpointId = (current: string): string => {
      const trimmed = current.trim()
      if (
        trimmed.length > 0 &&
        remoteOverviews.some(overview => overview.endpoint.endpointId === trimmed)
      ) {
        return trimmed
      }

      return remoteOverviews[0]?.endpoint.endpointId ?? ''
    }

    setDefaultRemoteEndpointId(resolveEndpointId(defaultRemoteEndpointId))
    setExtraRemoteEndpointId(resolveEndpointId(extraRemoteEndpointId))
  }, [
    defaultRemoteEndpointId,
    extraRemoteEndpointId,
    remoteOverviews,
    remoteWorkersEnabled,
    setDefaultRemoteEndpointId,
    setExtraRemoteEndpointId,
  ])

  const defaultRemoteOverview = overviewByEndpointId.get(defaultRemoteEndpointId.trim()) ?? null
  const extraRemoteOverview = overviewByEndpointId.get(extraRemoteEndpointId.trim()) ?? null

  const runRemoteEndpointAction = useCallback(
    async (endpointId: string) => {
      const overview = overviewByEndpointId.get(endpointId) ?? null
      if (!overview) {
        return
      }

      const action = getEndpointActionExecution(overview.recommendedAction)
      if (!action) {
        return
      }

      setError(null)
      try {
        if (action.kind === 'prepare') {
          await prepareEndpoint({ endpointId, reason: action.reason })
          return
        }

        await repairEndpoint({ endpointId, action: action.action })
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      }
    },
    [overviewByEndpointId, prepareEndpoint, repairEndpoint, setError],
  )

  const reconnectRemoteEndpoint = useCallback(
    async (endpointId: string) => {
      setError(null)
      try {
        await prepareEndpoint({ endpointId, reason: 'reconnect' })
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      }
    },
    [prepareEndpoint, setError],
  )

  return {
    remoteOverviews,
    endpointLabelById,
    endpointOptions,
    defaultRemoteOverview,
    extraRemoteOverview,
    endpointError,
    busyByEndpointId,
    reloadRemoteOverviews: reload,
    runRemoteEndpointAction,
    reconnectRemoteEndpoint,
  }
}
