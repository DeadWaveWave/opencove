import type { ServerResponse } from 'node:http'
import type { SyncEventPayload } from '../../../../shared/contracts/dto'

const SYNC_SSE_EVENT_NAME = 'opencove.sync'

export function writeSseEvent(res: ServerResponse, payload: SyncEventPayload): void {
  if (typeof payload.revision === 'number' && Number.isFinite(payload.revision)) {
    res.write(`id: ${payload.revision}\n`)
  }
  res.write(`event: ${SYNC_SSE_EVENT_NAME}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export type { SyncEventPayload }
