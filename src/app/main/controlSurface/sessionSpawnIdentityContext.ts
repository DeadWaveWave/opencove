import { AsyncLocalStorage } from 'node:async_hooks'

export interface CanvasSpawnIdentity {
  readonly projectId: string
  readonly spaceId: string
  readonly nodeId: string
}

export const canvasSpawnIdentity = new AsyncLocalStorage<CanvasSpawnIdentity>()
export const canvasSpawnOperations = new Set([
  'pty.spawn',
  'pty.spawnInMount',
  'session.spawnTerminal',
  'session.launchAgent',
  'session.launchAgentInMount',
])
