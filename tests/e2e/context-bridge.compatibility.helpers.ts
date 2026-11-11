import { expect, type ElectronApplication } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

export interface BridgeMainProbe {
  webContentsId: number
  acks: string[]
  inputBytes: number[]
  inputIsTypedArray: boolean
  writes: number
  bounds: number
}
export interface BridgePageProbe {
  barriers: number
  order: string[]
  stops: Array<() => void>
  flushCalls: string[]
  settle?: () => void
}
declare global {
  interface Window {
    __bridgeCompatibilityProbe: BridgePageProbe
  }
}

/** Actual production preload and installer, without React's independent flush subscription. */
export async function launchBridgeFixture() {
  const { electronApp } = await launchApp()
  try {
    const opened = electronApp.waitForEvent('window')
    await electronApp.evaluate(({ BrowserWindow, app, ipcMain }) => {
      const fixture = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: `${app.getAppPath()}/out/preload/index.js`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const probe: BridgeMainProbe = {
        webContentsId: fixture.webContents.id,
        acks: [],
        inputBytes: [],
        inputIsTypedArray: false,
        writes: 0,
        bounds: 0,
      }
      Object.assign(globalThis, { __bridgeCompatibilityMain: probe })
      ipcMain.on('app:persist-flush-complete', (event, payload) => {
        if (event.sender.id === probe.webContentsId) {
          probe.acks.push(payload.requestId)
        }
      })
      ipcMain.on('website-window:set-bounds', event => {
        if (event.sender.id === probe.webContentsId) {
          probe.bounds += 1
        }
      })
      // Main injection is upstream of the real isolated preload, never a renderer API mock.
      for (const [channel, handler] of [
        [
          'workspace:write-canvas-image',
          (_event: unknown, payload: { bytes: Uint8Array }) => {
            probe.writes += 1
            probe.inputIsTypedArray = payload.bytes instanceof Uint8Array
            probe.inputBytes = Array.from(payload.bytes)
            return { __opencoveIpcEnvelope: true, ok: true, value: undefined }
          },
        ],
        [
          'workspace:read-canvas-image',
          () => ({
            __opencoveIpcEnvelope: true,
            ok: true,
            value: { bytes: new Uint8Array(probe.inputBytes) },
          }),
        ],
      ] as const) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
      void fixture.loadFile(`${app.getAppPath()}/out/renderer/bridge-compatibility.html`)
    })
    const page = await opened
    await page.waitForFunction(
      () => typeof window.opencoveApi?.filesystem?.getPathForFile === 'function',
    )
    expect(await page.evaluate(() => typeof Reflect.get(globalThis, 'require'))).toBe('undefined')
    await page.evaluate(() => {
      const probe: BridgePageProbe = { barriers: 0, order: [], stops: [], flushCalls: [] }
      window.__bridgeCompatibilityProbe = probe
      probe.stops.push(
        window.opencoveApi.pty.onData(event => {
          if (event.sessionId === 'bridge-barrier') {
            probe.barriers += 1
          }
        }),
      )
    })
    return { electronApp, page }
  } catch (error) {
    await electronApp.close()
    throw error
  }
}
export async function sendBridgeEvents(
  app: ElectronApplication,
  events: Array<{ channel: string; payload: unknown }>,
) {
  await app.evaluate(({ webContents }, messages) => {
    const probe = (globalThis as unknown as { __bridgeCompatibilityMain: BridgeMainProbe })
      .__bridgeCompatibilityMain
    const target = webContents.fromId(probe.webContentsId)!
    for (const event of messages) {
      target.send(event.channel, event.payload)
    }
    target.send('pty:data', { sessionId: 'bridge-barrier', data: 'barrier' })
  }, events)
}
export function mainProbe(app: ElectronApplication) {
  return app.evaluate(
    () =>
      (globalThis as unknown as { __bridgeCompatibilityMain: BridgeMainProbe })
        .__bridgeCompatibilityMain,
  )
}
