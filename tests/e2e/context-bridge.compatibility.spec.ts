import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removePathWithRetry } from './workspace-canvas.helpers'
import {
  launchBridgeFixture,
  mainProbe,
  sendBridgeEvents,
} from './context-bridge.compatibility.helpers'

// These cases cross Electron's contextBridge, including callback proxies and native webUtils.
test('transfers native Files and bytes through the installed API and preserves sync returns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-bridge-file-'))
  let electronApp: ElectronApplication | undefined
  try {
    const fixture = await launchBridgeFixture()
    electronApp = fixture.electronApp
    const page = fixture.page
    const path = join(await realpath(root), 'native.bin')
    await writeFile(path, new Uint8Array([0, 1, 127, 128, 255]))
    await page.getByTestId('native-file').setInputFiles(path)
    const result = await page.evaluate(async () => {
      const api = window.opencoveApi
      const file = document.querySelector<HTMLInputElement>('input')!.files![0]
      const nativePath = api.filesystem.getPathForFile(file)
      const memoryPath = api.filesystem.getPathForFile(new File(['memory'], 'memory.txt'))
      const bounds = api.websiteWindow.setBounds({
        nodeId: 'bridge-test',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      })
      const bytes = new Uint8Array([0, 1, 127, 128, 255])
      await api.workspace.writeCanvasImage({
        assetId: 'bridge-test',
        bytes,
        mimeType: 'image/png',
        fileName: 'native.bin',
      })
      const output = await api.workspace.readCanvasImage({ assetId: 'bridge-test' })
      return {
        nativePath,
        nativeType: typeof nativePath,
        memoryPath,
        boundsUndefined: bounds === undefined,
        typed: output?.bytes instanceof Uint8Array,
        bytes: Array.from(output!.bytes),
      }
    })
    expect(result).toEqual({
      nativePath: path,
      nativeType: 'string',
      memoryPath: '',
      boundsUndefined: true,
      typed: true,
      bytes: [0, 1, 127, 128, 255],
    })
    await expect.poll(async () => (await mainProbe(fixture.electronApp)).bounds).toBe(1)
    expect(await mainProbe(fixture.electronApp)).toMatchObject({
      writes: 1,
      inputIsTypedArray: true,
      inputBytes: [0, 1, 127, 128, 255],
    })
  } finally {
    await electronApp?.close()
    await removePathWithRetry(root)
  }
})

test('replays PTY state and metadata synchronously in order and stops delivery on unsubscribe', async () => {
  const { electronApp, page } = await launchBridgeFixture()
  try {
    await sendBridgeEvents(electronApp, [
      {
        channel: 'pty:state',
        payload: {
          sessionId: 'bridge-replay',
          state: 'working',
          source: 'claude_hook',
          observedAtMs: 1,
        },
      },
      {
        channel: 'pty:state',
        payload: {
          sessionId: 'bridge-replay',
          state: 'waiting',
          source: 'session_file',
          observedAtMs: 2,
        },
      },
      {
        channel: 'pty:session-metadata',
        payload: {
          sessionId: 'bridge-replay',
          resumeSessionId: 'conversation',
          agentProvider: 'claude-code',
        },
      },
    ])
    await page.waitForFunction(() => window.__bridgeCompatibilityProbe.barriers === 1)
    const order = await page.evaluate(() => {
      const probe = window.__bridgeCompatibilityProbe
      probe.stops.push(
        window.opencoveApi.pty.onState(event => {
          if (event.sessionId === 'bridge-replay') {
            probe.order.push(`state:${event.state}`)
          }
        }),
      )
      probe.order.push('state:return')
      probe.stops.push(
        window.opencoveApi.pty.onMetadata(event => {
          if (event.sessionId === 'bridge-replay') {
            probe.order.push(`metadata:${event.resumeSessionId}`)
          }
        }),
      )
      probe.order.push('metadata:return')
      return probe.order
    })
    expect(order).toEqual([
      'state:working',
      'state:waiting',
      'state:return',
      'metadata:conversation',
      'metadata:return',
    ])
    await sendBridgeEvents(electronApp, [
      {
        channel: 'pty:state',
        payload: {
          sessionId: 'bridge-replay',
          state: 'idle',
          source: 'session_file',
          observedAtMs: 3,
        },
      },
      {
        channel: 'pty:session-metadata',
        payload: {
          sessionId: 'bridge-replay',
          resumeSessionId: 'next',
          agentProvider: 'claude-code',
        },
      },
    ])
    await page.waitForFunction(() => window.__bridgeCompatibilityProbe.barriers === 2)
    const delivered = [...order, 'state:idle', 'metadata:next']
    expect(await page.evaluate(() => window.__bridgeCompatibilityProbe.order)).toEqual(delivered)
    await page.evaluate(() => {
      window.__bridgeCompatibilityProbe.stops.splice(1).forEach(stop => stop())
    })
    await sendBridgeEvents(electronApp, [
      {
        channel: 'pty:state',
        payload: {
          sessionId: 'bridge-replay',
          state: 'exited',
          source: 'session_file',
          observedAtMs: 4,
        },
      },
      {
        channel: 'pty:session-metadata',
        payload: {
          sessionId: 'bridge-replay',
          resumeSessionId: 'never-delivered',
          agentProvider: 'claude-code',
        },
      },
    ])
    await page.waitForFunction(() => window.__bridgeCompatibilityProbe.barriers === 3)
    expect(await page.evaluate(() => window.__bridgeCompatibilityProbe.order)).toEqual(delivered)
  } finally {
    await electronApp.close()
  }
})

for (const outcome of ['resolve', 'reject'] as const) {
  test(`acknowledges flush only after the renderer callback Promise ${outcome}s`, async () => {
    const { electronApp, page } = await launchBridgeFixture()
    try {
      await page.evaluate(mode => {
        const probe = window.__bridgeCompatibilityProbe
        probe.stops.push(
          window.opencoveApi.lifecycle.onRequestPersistFlush(({ requestId }) => {
            probe.flushCalls.push(requestId)
            return new Promise<void>((resolveCallback, rejectCallback) => {
              probe.settle = () =>
                mode === 'resolve'
                  ? resolveCallback()
                  : rejectCallback(new Error('delayed flush failure'))
            })
          }),
        )
      }, outcome)
      await sendBridgeEvents(electronApp, [
        { channel: 'app:request-persist-flush', payload: { requestId: 'held-flush' } },
      ])
      await page.waitForFunction(
        () =>
          window.__bridgeCompatibilityProbe.flushCalls.length === 1 &&
          window.__bridgeCompatibilityProbe.barriers === 1,
      )
      // Round trip after callback entry drains any premature ACK queued by preload microtasks.
      await page.evaluate(() =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'system.ping',
          payload: null,
        }),
      )
      expect((await mainProbe(electronApp)).acks).toEqual([])
      await page.evaluate(() => window.__bridgeCompatibilityProbe.settle!())
      await expect.poll(async () => (await mainProbe(electronApp)).acks).toEqual(['held-flush'])
      await page.evaluate(() => {
        window.__bridgeCompatibilityProbe.stops.splice(1).forEach(stop => stop())
      })
      await sendBridgeEvents(electronApp, [
        { channel: 'app:request-persist-flush', payload: { requestId: 'after-unsubscribe' } },
      ])
      await page.waitForFunction(() => window.__bridgeCompatibilityProbe.barriers === 2)
      await page.evaluate(() =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'system.ping',
          payload: null,
        }),
      )
      expect(await page.evaluate(() => window.__bridgeCompatibilityProbe.flushCalls)).toEqual([
        'held-flush',
      ])
      expect((await mainProbe(electronApp)).acks).toEqual(['held-flush'])
    } finally {
      await electronApp.close()
    }
  })
}
