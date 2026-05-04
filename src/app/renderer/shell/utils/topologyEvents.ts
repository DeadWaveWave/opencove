export const TOPOLOGY_CHANGED_EVENT = 'opencove:topology-changed'
export const ENDPOINT_OVERVIEWS_CHANGED_EVENT = 'opencove:endpoint-overviews-changed'

export function notifyTopologyChanged(): void {
  window.dispatchEvent(new Event(TOPOLOGY_CHANGED_EVENT))
}

export function notifyEndpointOverviewsChanged(): void {
  window.dispatchEvent(new Event(ENDPOINT_OVERVIEWS_CHANGED_EVENT))
}
