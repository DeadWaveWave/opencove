// @vitest-environment node

import { connect } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { ControlSurfaceAcceptedRequestOwner } from '../../../src/app/main/controlSurface/controlSurfaceAcceptedRequestOwner'
import { createControlSurfaceHttpListener } from '../../../src/app/main/controlSurface/controlSurfaceHttpListener'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Control Surface HTTP listener', () => {
  it('cannot bind or become ready after stop starts during listener startup', async () => {
    const onDisposed = vi.fn()
    const listener = createControlSurfaceHttpListener({
      config: {
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'web',
        enableWebShell: true,
        webUiPasswordHash: null,
      },
      isRuntimeClosed: () => false,
      handleRequest: async ({ res }) => res.end(),
      handleUpgrade: (_req, socket) => socket.destroy(),
      onDisposed,
    })

    const stopping = listener.stopAccepting()
    await expect(listener.ready).rejects.toThrow('stopped before becoming ready')
    await stopping

    expect(listener.isAccepting()).toBe(false)
    expect(onDisposed).toHaveBeenCalledOnce()
  })

  it('fences accepted requests when password admission changes in flight', async () => {
    const requestCanFinish = deferred()
    const requestStarted = deferred()
    let authRevisionCurrent: (() => boolean) | null = null
    const listener = createControlSurfaceHttpListener({
      config: {
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'web',
        enableWebShell: true,
        webUiPasswordHash: 'first',
      },
      isRuntimeClosed: () => false,
      handleRequest: async ({ res, listener: requestContext }) => {
        authRevisionCurrent = requestContext.isWebUiAuthRevisionCurrent
        requestStarted.resolve()
        await requestCanFinish.promise
        res.end(String(requestContext.isWebUiAuthRevisionCurrent()))
      },
      handleUpgrade: (_req, socket) => socket.destroy(),
      onDisposed: vi.fn(),
    })
    const address = await listener.ready
    const response = fetch(`http://127.0.0.1:${address.port}/`)
    await requestStarted.promise

    expect(authRevisionCurrent?.()).toBe(true)
    listener.updateWebUiPasswordHash('second')
    expect(authRevisionCurrent?.()).toBe(false)
    requestCanFinish.resolve()

    await expect(response.then(async result => await result.text())).resolves.toBe('false')
    await listener.dispose()
  })
  it('forces a partial accepted request closed at the configured drain deadline', async () => {
    const requestStarted = deferred()
    const onDisposed = vi.fn()
    const listener = createControlSurfaceHttpListener({
      config: {
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'web',
        enableWebShell: true,
        webUiPasswordHash: null,
      },
      isRuntimeClosed: () => false,
      handleRequest: async ({ req }) => {
        requestStarted.resolve()
        await new Promise<void>((resolve, reject) => {
          req.on('end', resolve)
          req.on('error', reject)
          req.resume()
        })
      },
      handleUpgrade: (_req, socket) => socket.destroy(),
      onDisposed,
    })
    const address = await listener.ready
    const socket = connect(address.port, '127.0.0.1')
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    const socketClosed = new Promise<void>(resolve => socket.once('close', () => resolve()))
    socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx')
    await requestStarted.promise

    await listener.stopAccepting({ drainTimeoutMs: 20 })
    await socketClosed

    expect(socket.destroyed).toBe(true)
    expect(onDisposed).toHaveBeenCalledOnce()
  })

  it('keeps accepted streams alive until a retired generation is explicitly drained', async () => {
    const streamStarted = deferred()
    const onDisposed = vi.fn()
    const listener = createControlSurfaceHttpListener({
      config: {
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'web',
        enableWebShell: true,
        webUiPasswordHash: null,
      },
      isRuntimeClosed: () => false,
      handleRequest: async ({ res, listenerSyncClients }) => {
        listenerSyncClients.add(res)
        streamStarted.resolve()
      },
      handleUpgrade: (_req, socket) => socket.destroy(),
      onDisposed,
    })
    const address = await listener.ready
    const response = fetch(`http://127.0.0.1:${address.port}/`)
    await streamStarted.promise

    await listener.stopAccepting({ preserveStreamingClients: true })
    expect(onDisposed).not.toHaveBeenCalled()

    listener.closeStreamingClients()
    await expect(response).resolves.toMatchObject({ status: 200 })
    expect(onDisposed).toHaveBeenCalledOnce()
  })

  it('retains accepted handler ownership after a bounded transport drain', async () => {
    const requestCanFinish = deferred()
    const requestStarted = deferred()
    const acceptedRequests = new ControlSurfaceAcceptedRequestOwner()
    const listener = createControlSurfaceHttpListener({
      acceptedRequests,
      config: {
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'private',
        enableWebShell: false,
        webUiPasswordHash: null,
      },
      isRuntimeClosed: () => false,
      handleRequest: async ({ res }) => {
        requestStarted.resolve()
        await requestCanFinish.promise
        res.end('done')
      },
      handleUpgrade: (_req, socket) => socket.destroy(),
      onDisposed: vi.fn(),
    })
    const address = await listener.ready
    const response = fetch(`http://127.0.0.1:${address.port}/`).catch(error => error)
    await requestStarted.promise
    await listener.stopAccepting({ drainTimeoutMs: 0 })

    let drained = false
    const draining = acceptedRequests.sealAndDrain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    requestCanFinish.resolve()
    await draining
    await response
    expect(drained).toBe(true)
  })

  it('stops admission but drains an already accepted request before disposal settles', async () => {
    const requestCanFinish = deferred()
    const requestStarted = deferred()
    const onDisposed = vi.fn()
    const listener = createControlSurfaceHttpListener({
      config: {
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'private',
        enableWebShell: false,
        webUiPasswordHash: null,
      },
      isRuntimeClosed: () => false,
      handleRequest: async ({ res }) => {
        requestStarted.resolve()
        await requestCanFinish.promise
        res.end('done')
      },
      handleUpgrade: (_req, socket) => socket.destroy(),
      onDisposed,
    })
    const address = await listener.ready
    const response = fetch(`http://127.0.0.1:${address.port}/`)
    await requestStarted.promise

    let stopped = false
    const stopping = listener.stopAccepting().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)

    requestCanFinish.resolve()
    await expect(response.then(async result => await result.text())).resolves.toBe('done')
    await stopping
    expect(onDisposed).toHaveBeenCalledOnce()
  })
})
