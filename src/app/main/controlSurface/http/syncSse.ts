import type { ServerResponse } from 'node:http'

const SYNC_SSE_EVENT_NAME = 'opencove.sync'

export type SyncEventPayload =
  | {
      type: 'app_state.updated'
      revision: number
      operationId: string
    }
  | {
      type: 'resync_required'
      revision: number
    }

export function writeSseEvent(res: ServerResponse, payload: SyncEventPayload): void {
  res.write(`id: ${payload.revision}\n`)
  res.write(`event: ${SYNC_SSE_EVENT_NAME}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}
