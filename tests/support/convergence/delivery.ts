import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'
import { publishSyncEvent } from '../../../src/app/main/controlSurface/http/publishSyncEvent'
import { serveSyncEvents } from '../../../src/app/main/controlSurface/http/serveSyncEvents'

/** Real buffered publisher and handshake; the renderer and oracle stay independent. */
export class Delivery {
  buffer: SyncEventPayload[] = []
  private clients = new Set<ServerResponse>()
  private request?: IncomingMessage
  constructor(
    private revision: () => number,
    private receive: (event: SyncEventPayload) => void,
  ) {}
  commit() {
    publishSyncEvent({
      syncClients: this.clients,
      syncEventBuffer: this.buffer,
      maxBufferSize: 256,
      payload: {
        type: 'app_state.updated',
        revision: this.revision(),
        operationId: 'appState.commit',
      },
    })
  }
  disconnect() {
    this.request?.emit('close')
    this.request = undefined
  }
  restartWorker() {
    this.disconnect()
    this.buffer = []
  }
  async connect() {
    this.disconnect()
    const req = new EventEmitter() as IncomingMessage
    this.request = req
    const res = Object.assign(new EventEmitter(), {
      write: (chunk: string) => {
        if (chunk.startsWith('data: ')) {
          this.receive(JSON.parse(chunk.slice(6)))
        }
        return true
      },
      end: () => req.emit('close'),
    }) as unknown as ServerResponse
    await serveSyncEvents({
      req,
      res,
      clients: this.clients,
      listenerClients: new Set(),
      buffer: this.buffer,
      afterRevision: this.revision(),
      isRevoked: () => false,
      readSnapshot: async () => ({ revision: this.revision(), state: null }),
    })
  }
}
