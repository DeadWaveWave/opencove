import type { EndpointOverviewControlPort } from '@contexts/topology/application/ports/EndpointOverviewControlPort'
import type {
  ListWorkerEndpointOverviewsResult,
  PrepareWorkerEndpointResult,
  RepairWorkerEndpointResult,
} from '@shared/contracts/dto'

/** Desktop preload and browser Control Surface share this boundary. */
export function createEndpointOverviewControlSurfaceAdapter(): EndpointOverviewControlPort {
  return {
    list: async () => {
      const result =
        await window.opencoveApi.controlSurface.invoke<ListWorkerEndpointOverviewsResult>({
          kind: 'query',
          id: 'endpoint.overview.list',
          payload: null,
        })
      return result.endpoints
    },
    prepare: async input => {
      const result = await window.opencoveApi.controlSurface.invoke<PrepareWorkerEndpointResult>({
        kind: 'command',
        id: 'endpoint.prepare',
        payload: input,
      })
      return result.overview
    },
    repair: async input => {
      const result = await window.opencoveApi.controlSurface.invoke<RepairWorkerEndpointResult>({
        kind: 'command',
        id: 'endpoint.repair',
        payload: input,
      })
      return result.overview
    },
  }
}
