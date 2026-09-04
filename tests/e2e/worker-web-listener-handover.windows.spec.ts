import { expect, test } from '@playwright/test'
import { createControlSurfaceHttpListener } from '../../src/app/main/controlSurface/controlSurfaceHttpListener'

const windowsOnly = process.platform !== 'win32'
test.skip(windowsOnly, 'Windows only')

function listen(bindHostname: string, port: number) {
  return createControlSurfaceHttpListener({
    config: {
      hostname: '127.0.0.1',
      bindHostname,
      port,
      role: 'web',
      enableWebShell: true,
      webUiPasswordHash: null,
    },
    isRuntimeClosed: () => false,
    handleRequest: async ({ res }) => res.end(bindHostname),
    handleUpgrade: (_req, socket) => socket.destroy(),
    onDisposed: () => undefined,
  })
}

test('releases and restores a same-port Web listener without relying on port reuse', async () => {
  const loopback = listen('127.0.0.1', 0)
  const address = await loopback.ready
  const conflicting = listen('127.0.0.1', address.port)

  await expect(conflicting.ready).rejects.toThrow(/EADDRINUSE/u)
  await conflicting.dispose()

  await loopback.stopAccepting()
  const wildcard = listen('0.0.0.0', address.port)
  await expect(wildcard.ready).resolves.toMatchObject({
    bindHostname: '0.0.0.0',
    port: address.port,
  })
  await expect(
    fetch(`http://127.0.0.1:${address.port}/`).then(response => response.text()),
  ).resolves.toBe('0.0.0.0')

  await wildcard.stopAccepting()
  const restored = listen('127.0.0.1', address.port)
  await expect(restored.ready).resolves.toMatchObject({
    bindHostname: '127.0.0.1',
    port: address.port,
  })
  await expect(
    fetch(`http://127.0.0.1:${address.port}/`).then(response => response.text()),
  ).resolves.toBe('127.0.0.1')
  await restored.dispose()
})
