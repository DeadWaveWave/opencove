import { EventEmitter } from 'node:events'
import type { Server, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  closeHttpServerAfterActiveRequests,
  registerHttpResponseShutdownDrain,
} from '../../../src/app/main/controlSurface/http/httpServerDrain'

describe('HTTP server shutdown drain', () => {
  it('closes a connection when its accepted response becomes idle during shutdown', () => {
    const response = new EventEmitter() as ServerResponse
    const closeIdleConnections = vi.fn()
    const server = { closeIdleConnections } as unknown as Server
    let closing = false
    registerHttpResponseShutdownDrain({ server, response, isClosing: () => closing })

    response.emit('finish')
    expect(closeIdleConnections).not.toHaveBeenCalled()

    closing = true
    response.emit('close')
    expect(closeIdleConnections).toHaveBeenCalledTimes(1)
  })

  it('stops admission and closes connections that are already idle', async () => {
    let completeClose!: () => void
    const closeIdleConnections = vi.fn()
    const server = {
      close: vi.fn((callback: () => void) => {
        completeClose = callback
        return server
      }),
      closeIdleConnections,
    } as unknown as Server
    let settled = false

    const closing = closeHttpServerAfterActiveRequests(server).then(() => {
      settled = true
    })

    expect(server.close).toHaveBeenCalledTimes(1)
    expect(closeIdleConnections).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)

    completeClose()
    await closing
    expect(settled).toBe(true)
  })
})
