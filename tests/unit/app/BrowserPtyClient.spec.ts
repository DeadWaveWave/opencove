import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyClient } from '../../../src/app/renderer/browser/BrowserPtyClient'

describe('BrowserPtyClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('emits resync instead of replaying raw snapshot data on overflow', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        search: '',
      },
      clearTimeout,
      setTimeout,
    })

    const client = new BrowserPtyClient()
    const resyncListener = vi.fn()
    const dataListener = vi.fn()

    client.onResync(resyncListener)
    client.onData(dataListener)

    await (client as unknown as { handleMessage: (raw: string) => Promise<void> }).handleMessage(
      JSON.stringify({
        type: 'overflow',
        sessionId: 'session-1',
        seq: 42,
        reason: 'replay_window_exceeded',
        recovery: 'presentation_snapshot',
      }),
    )

    expect(resyncListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      reason: 'replay_window_exceeded',
      recovery: 'presentation_snapshot',
    })
    expect(dataListener).not.toHaveBeenCalled()
  })
})
