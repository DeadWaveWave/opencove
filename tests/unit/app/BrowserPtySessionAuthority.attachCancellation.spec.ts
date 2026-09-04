import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyClient } from '../../../src/app/renderer/browser/BrowserPtyClient'
import type {
  BrowserPtySocketLease,
  BrowserPtySocketLifecycle,
} from '../../../src/app/renderer/browser/BrowserPtySocketLifecycle'

type ClientInternals = {
  socketLifecycle: BrowserPtySocketLifecycle
}

function installWindow(): void {
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host: 'localhost:3000', search: '' },
    clearTimeout,
    setTimeout,
  })
}

describe('BrowserPtySessionAuthority attach cancellation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not send an attach after client detach wins a delayed socket connection', async () => {
    installWindow()
    let resolveReady!: (lease: BrowserPtySocketLease) => void
    const lease = Object.freeze({}) as BrowserPtySocketLease
    const client = new BrowserPtyClient()
    const lifecycle = (client as unknown as ClientInternals).socketLifecycle
    const sendIfCurrent = vi.spyOn(lifecycle, 'sendIfCurrent').mockReturnValue(true)
    vi.spyOn(lifecycle, 'ensureReady').mockImplementation(
      async () =>
        await new Promise<BrowserPtySocketLease>(resolve => {
          resolveReady = resolve
        }),
    )

    const outcome = client.attach({ sessionId: 'session-delayed-connect' }).then(
      () => null,
      error => error as Error,
    )
    await client.detach({ sessionId: 'session-delayed-connect' })
    resolveReady(lease)
    await Promise.resolve()
    await client.detach({ sessionId: 'session-delayed-connect' })

    await expect(outcome).resolves.toMatchObject({
      message: 'Terminal session detached before attach completed',
    })
    expect(sendIfCurrent).not.toHaveBeenCalled()
  })
})
