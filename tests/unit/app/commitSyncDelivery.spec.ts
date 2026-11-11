import { expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import { publishSyncEvent } from '../../../src/app/main/controlSurface/http/publishSyncEvent'

it('buffers the exact commit and still delivers SSE when Desktop throws', () => {
  const write = vi.fn()
  const client = { write } as unknown as ServerResponse
  const buffer = []
  const payload = {
    type: 'app_state.updated' as const,
    revision: 7,
    operationId: 'sync.writeState',
  }
  expect(() =>
    publishSyncEvent({
      syncClients: new Set([client]),
      syncEventBuffer: buffer,
      maxBufferSize: 256,
      payload,
      desktopSink: () => {
        throw new Error('window closed')
      },
    }),
  ).not.toThrow()
  expect(buffer).toEqual([payload])
  expect(write).toHaveBeenCalledWith(
    'data: {"type":"app_state.updated","revision":7,"operationId":"sync.writeState"}\n\n',
  )
})
