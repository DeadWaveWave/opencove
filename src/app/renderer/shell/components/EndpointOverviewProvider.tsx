import React, { createContext, useContext, useEffect, useState } from 'react'
import { EndpointOverviewProjectionOwner } from '@contexts/topology/application/EndpointOverviewProjectionOwner'
import { createEndpointOverviewControlSurfaceAdapter } from '../utils/endpointOverviewControlSurfaceAdapter'
import { toErrorMessage } from '../utils/format'
import { ENDPOINT_OVERVIEWS_CHANGED_EVENT, TOPOLOGY_CHANGED_EVENT } from '../utils/topologyEvents'

const EndpointOverviewContext = createContext<EndpointOverviewProjectionOwner | null>(null)

export function EndpointOverviewProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [owner] = useState(
    () =>
      new EndpointOverviewProjectionOwner({
        port: createEndpointOverviewControlSurfaceAdapter(),
        formatError: toErrorMessage,
        schedule: (callback, delay) => {
          const timer = window.setTimeout(callback, delay)
          return () => window.clearTimeout(timer)
        },
      }),
  )
  useEffect(() => {
    window.addEventListener(TOPOLOGY_CHANGED_EVENT, owner.topologyChanged)
    window.addEventListener(ENDPOINT_OVERVIEWS_CHANGED_EVENT, owner.refreshIfObserved)
    return () => {
      window.removeEventListener(TOPOLOGY_CHANGED_EVENT, owner.topologyChanged)
      window.removeEventListener(ENDPOINT_OVERVIEWS_CHANGED_EVENT, owner.refreshIfObserved)
      // Consumer cleanup fences queries and stops timers, including StrictMode replay.
      // Accepted commands may still settle; they never restart polling without a consumer.
    }
  }, [owner])
  return (
    <EndpointOverviewContext.Provider value={owner}>{children}</EndpointOverviewContext.Provider>
  )
}

export function useEndpointOverviewOwner(): EndpointOverviewProjectionOwner {
  const owner = useContext(EndpointOverviewContext)
  if (!owner) {
    throw new Error('EndpointOverviewProvider is required.')
  }
  return owner
}
