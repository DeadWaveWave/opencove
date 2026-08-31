// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createControlSurfaceHttpListener } from '../../../src/app/main/controlSurface/controlSurfaceHttpListener'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Control Surface HTTP listener', () => {
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
