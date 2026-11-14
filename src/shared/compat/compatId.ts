import type registry from './compatRegistry.json'

/** Id of a compatibility registry entry; `compatRegistry.json` is the only place that defines it. */
export type CompatId = keyof (typeof registry)['entries']
