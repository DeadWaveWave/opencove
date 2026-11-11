import { AsyncLocalStorage } from 'node:async_hooks'

/** Worker-local runtime observation; never part of forwarded identity or request authority. */
export const remoteSpawnObservation = new AsyncLocalStorage<(nodeId: string) => void>()
