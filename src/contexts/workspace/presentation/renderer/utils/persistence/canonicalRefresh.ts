export interface CanonicalRefreshRequest {
  minimumRevision?: number
  reason: 'corrected' | 'merged' | 'identity-conflict' | 'uncertain' | 'connect'
}
let demand: (CanonicalRefreshRequest & { generation: number }) | null = null
let generation = 0
const listeners = new Set<() => void>()
export function requestCanonicalRefresh(request: CanonicalRefreshRequest): void {
  demand = {
    ...request,
    generation: ++generation,
    minimumRevision: Math.max(demand?.minimumRevision ?? 0, request.minimumRevision ?? 0),
  }
  for (const listener of listeners) {
    listener()
  }
}
export function getCanonicalRefreshDemand() {
  return demand
}
export function acknowledgeCanonicalRefresh(observedGeneration: number): void {
  if (demand?.generation === observedGeneration) {
    demand = null
  }
}
export function resetCanonicalRefresh(): void {
  demand = null
}
export function subscribeCanonicalRefresh(listener: () => void): () => void {
  listeners.add(listener)
  if (demand) {
    listener()
  }
  return () => {
    listeners.delete(listener)
  }
}
