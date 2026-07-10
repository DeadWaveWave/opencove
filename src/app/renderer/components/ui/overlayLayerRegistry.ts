export type OverlayLayerId = number

let nextLayerId = 0
const activeLayers = new Set<OverlayLayerId>()
const branchesByLayer = new Map<OverlayLayerId, Set<HTMLElement>>()
const claimedEvents = new WeakSet<Event>()

export function createOverlayLayerId(): OverlayLayerId {
  nextLayerId += 1
  return nextLayerId
}

export function registerOverlayLayer(layerId: OverlayLayerId): () => void {
  activeLayers.add(layerId)

  return () => {
    activeLayers.delete(layerId)
    branchesByLayer.delete(layerId)
  }
}

export function isTopOverlayLayer(layerId: OverlayLayerId): boolean {
  let topLayerId: OverlayLayerId | null = null

  for (const activeLayerId of activeLayers) {
    if (topLayerId === null || activeLayerId > topLayerId) {
      topLayerId = activeLayerId
    }
  }

  return topLayerId === layerId
}

export function claimOverlayLayerEvent(layerId: OverlayLayerId, event: Event): boolean {
  if (!isTopOverlayLayer(layerId) || claimedEvents.has(event)) {
    return false
  }

  claimedEvents.add(event)
  return true
}

export function registerOverlayBranch(layerId: OverlayLayerId, branch: HTMLElement): () => void {
  const branches = branchesByLayer.get(layerId) ?? new Set<HTMLElement>()
  branches.add(branch)
  branchesByLayer.set(layerId, branches)

  return () => {
    branches.delete(branch)
    if (branches.size === 0) {
      branchesByLayer.delete(layerId)
    }
  }
}

export function getOverlayBranches(layerId: OverlayLayerId): readonly HTMLElement[] {
  return Array.from(branchesByLayer.get(layerId) ?? [])
}
