import type { ServerResponse } from 'node:http'
import { writeSseEvent, type SyncEventPayload } from './syncSse'

export function publishSyncEvent(options: {
  syncClients: Set<ServerResponse>
  syncEventBuffer: SyncEventPayload[]
  maxBufferSize: number
  payload: SyncEventPayload
}): void {
  options.syncEventBuffer.push(options.payload)
  if (options.syncEventBuffer.length > options.maxBufferSize) {
    options.syncEventBuffer.splice(0, options.syncEventBuffer.length - options.maxBufferSize)
  }

  for (const client of options.syncClients) {
    try {
      writeSseEvent(client, options.payload)
    } catch {
      try {
        client.end()
      } catch {
        // ignore
      }

      options.syncClients.delete(client)
    }
  }
}
