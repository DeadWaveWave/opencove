import type { IncomingMessage, ServerResponse } from 'node:http'
import { writeSseEvent, type SyncEventPayload } from './syncSse'

/** A transport cursor is not an acknowledgement that canonical state was applied. */
export async function serveSyncEvents(input: {
  req: IncomingMessage
  res: ServerResponse
  clients: Set<ServerResponse>
  listenerClients: Set<ServerResponse>
  buffer: readonly SyncEventPayload[]
  afterRevision: number | null
  readSnapshot(): Promise<{ revision: number | null; state: unknown }>
  isRevoked(): boolean
}): Promise<void> {
  const { req, res, clients, listenerClients } = input
  let closed = false
  const cleanup = () => {
    closed = true
    clients.delete(res)
    listenerClients.delete(res)
    req.off('close', cleanup)
    res.off('close', cleanup)
  }
  req.once('close', cleanup)
  res.once('close', cleanup)
  clients.add(res)
  listenerClients.add(res)
  try {
    // Capture replay before awaiting; commits in the gap are already delivered live.
    if (input.afterRevision !== null) {
      for (const payload of input.buffer) {
        if (payload.revision > input.afterRevision) {
          writeSseEvent(res, payload)
        }
      }
    }
    const snapshot = await input.readSnapshot()
    if (closed || input.isRevoked()) {
      cleanup()
      return
    }
    if (
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision === null ||
      snapshot.revision < 0
    ) {
      throw new Error('Canonical revision unavailable')
    }
    writeSseEvent(res, { type: 'resync_required', revision: snapshot.revision })
  } catch {
    cleanup()
    res.end()
  }
}
