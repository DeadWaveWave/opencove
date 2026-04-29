import type { ServerResponse } from 'node:http'
import { writeSseEvent, type SyncEventPayload } from './syncSse'

export function publishSyncEvent(options: {
  syncClients: Set<ServerResponse>
  syncEventBuffer: SyncEventPayload[]
  maxBufferSize: number
  payload: SyncEventPayload
  desktopSink?: (payload: SyncEventPayload) => number
}): number {
  options.syncEventBuffer.push(options.payload)
  if (options.syncEventBuffer.length > options.maxBufferSize) {
    options.syncEventBuffer.splice(0, options.syncEventBuffer.length - options.maxBufferSize)
  }

  return publishLiveSyncEvent(options)
}

export function publishLiveSyncEvent(options: {
  syncClients: Set<ServerResponse>
  payload: SyncEventPayload
  desktopSink?: (payload: SyncEventPayload) => number
}): number {
  let deliveredCount = options.desktopSink?.(options.payload) ?? 0

  for (const client of options.syncClients) {
    try {
      writeSseEvent(client, options.payload)
      deliveredCount += 1
    } catch {
      try {
        client.end()
      } catch {
        // ignore
      }

      options.syncClients.delete(client)
    }
  }

  return deliveredCount
}
