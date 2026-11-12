import { AsyncLocalStorage } from 'node:async_hooks'

/** Session authority is independent of an optional canvas-node binding. */
export interface CanvasSpawnIdentity {
  readonly delegated?: boolean
  readonly projectId: string
  readonly spaceId: string
  readonly nodeId: string | null
}

export const canvasSpawnIdentity = new AsyncLocalStorage<CanvasSpawnIdentity>()
export const canvasSpawnOperations = new Set([
  'pty.spawn',
  'pty.spawnInMount',
  'session.spawnTerminal',
  'session.launchAgent',
  'session.launchAgentInMount',
])

export function localCanvasResidentContext(): 'canvas' | 'none' {
  const identity = canvasSpawnIdentity.getStore()
  return identity?.nodeId && !identity.delegated ? 'canvas' : 'none'
}
