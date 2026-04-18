export const TOPOLOGY_CHANGED_EVENT = 'opencove:topology-changed'

export function notifyTopologyChanged(): void {
  window.dispatchEvent(new Event(TOPOLOGY_CHANGED_EVENT))
}
