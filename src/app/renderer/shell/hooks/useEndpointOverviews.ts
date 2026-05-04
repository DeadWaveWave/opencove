import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ListWorkerEndpointOverviewsResult,
  PrepareWorkerEndpointInput,
  PrepareWorkerEndpointResult,
  RepairWorkerEndpointInput,
  RepairWorkerEndpointResult,
  WorkerEndpointOverviewDto,
} from '@shared/contracts/dto'
import { toErrorMessage } from '../utils/format'
import {
  ENDPOINT_OVERVIEWS_CHANGED_EVENT,
  TOPOLOGY_CHANGED_EVENT,
  notifyEndpointOverviewsChanged,
} from '../utils/topologyEvents'

function replaceOverview(
  current: WorkerEndpointOverviewDto[],
  nextOverview: WorkerEndpointOverviewDto,
): WorkerEndpointOverviewDto[] {
  let matched = false
  const next = current.map(overview => {
    if (overview.endpoint.endpointId !== nextOverview.endpoint.endpointId) {
      return overview
    }

    matched = true
    return nextOverview
  })

  if (matched) {
    return next
  }

  return [...next, nextOverview]
}

export function useEndpointOverviews({
  enabled = true,
}: {
  enabled?: boolean
} = {}): {
  overviews: WorkerEndpointOverviewDto[]
  remoteOverviews: WorkerEndpointOverviewDto[]
  overviewByEndpointId: ReadonlyMap<string, WorkerEndpointOverviewDto>
  isLoading: boolean
  error: string | null
  busyByEndpointId: Readonly<Record<string, 'prepare' | 'repair'>>
  reload: () => Promise<void>
  prepareEndpoint: (input: PrepareWorkerEndpointInput) => Promise<WorkerEndpointOverviewDto>
  repairEndpoint: (input: RepairWorkerEndpointInput) => Promise<WorkerEndpointOverviewDto>
} {
  const requestCounterRef = useRef(0)
  const [overviews, setOverviews] = useState<WorkerEndpointOverviewDto[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyByEndpointId, setBusyByEndpointId] = useState<Record<string, 'prepare' | 'repair'>>({})

  const applyOverview = useCallback((overview: WorkerEndpointOverviewDto) => {
    setOverviews(current => replaceOverview(current, overview))
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setOverviews([])
      setError(null)
      return
    }

    const requestId = (requestCounterRef.current += 1)
    setIsLoading(true)
    setError(null)

    try {
      const result =
        await window.opencoveApi.controlSurface.invoke<ListWorkerEndpointOverviewsResult>({
          kind: 'query',
          id: 'endpoint.overview.list',
          payload: null,
        })

      if (requestCounterRef.current !== requestId) {
        return
      }

      setOverviews(result.endpoints)
    } catch (caughtError) {
      if (requestCounterRef.current !== requestId) {
        return
      }

      setError(toErrorMessage(caughtError))
    } finally {
      if (requestCounterRef.current === requestId) {
        setIsLoading(false)
      }
    }
  }, [enabled])

  const prepareEndpoint = useCallback(
    async (input: PrepareWorkerEndpointInput): Promise<WorkerEndpointOverviewDto> => {
      setError(null)
      setBusyByEndpointId(current => ({ ...current, [input.endpointId]: 'prepare' }))

      try {
        const result = await window.opencoveApi.controlSurface.invoke<PrepareWorkerEndpointResult>({
          kind: 'command',
          id: 'endpoint.prepare',
          payload: input,
        })
        applyOverview(result.overview)
        notifyEndpointOverviewsChanged()
        return result.overview
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
        throw caughtError
      } finally {
        setBusyByEndpointId(current => {
          const next = { ...current }
          delete next[input.endpointId]
          return next
        })
      }
    },
    [applyOverview],
  )

  const repairEndpoint = useCallback(
    async (input: RepairWorkerEndpointInput): Promise<WorkerEndpointOverviewDto> => {
      setError(null)
      setBusyByEndpointId(current => ({ ...current, [input.endpointId]: 'repair' }))

      try {
        const result = await window.opencoveApi.controlSurface.invoke<RepairWorkerEndpointResult>({
          kind: 'command',
          id: 'endpoint.repair',
          payload: input,
        })
        applyOverview(result.overview)
        notifyEndpointOverviewsChanged()
        return result.overview
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
        throw caughtError
      } finally {
        setBusyByEndpointId(current => {
          const next = { ...current }
          delete next[input.endpointId]
          return next
        })
      }
    },
    [applyOverview],
  )

  useEffect(() => {
    if (!enabled) {
      setOverviews([])
      setError(null)
      setIsLoading(false)
      return
    }

    void reload()
  }, [enabled, reload])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleChanged = () => {
      void reload()
    }

    window.addEventListener(TOPOLOGY_CHANGED_EVENT, handleChanged)
    window.addEventListener(ENDPOINT_OVERVIEWS_CHANGED_EVENT, handleChanged)

    return () => {
      window.removeEventListener(TOPOLOGY_CHANGED_EVENT, handleChanged)
      window.removeEventListener(ENDPOINT_OVERVIEWS_CHANGED_EVENT, handleChanged)
    }
  }, [enabled, reload])

  const remoteOverviews = useMemo(
    () => overviews.filter(overview => overview.endpoint.endpointId !== 'local'),
    [overviews],
  )
  const overviewByEndpointId = useMemo(
    () => new Map(overviews.map(overview => [overview.endpoint.endpointId, overview] as const)),
    [overviews],
  )

  return {
    overviews,
    remoteOverviews,
    overviewByEndpointId,
    isLoading,
    error,
    busyByEndpointId,
    reload,
    prepareEndpoint,
    repairEndpoint,
  }
}
