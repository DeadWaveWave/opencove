import { expect, type ElectronApplication } from '@playwright/test'

export async function prepareIdleWebsiteSnapshot(electronApp: ElectronApplication): Promise<void> {
  const observation = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const runtime = win.__opencoveWebsiteWindowManager?.runtimeByNodeId.get('website-freeze-node')
    if (!runtime?.view) {
      throw new Error('Website view unavailable')
    }
    const contents = runtime.view.webContents
    const debuggerApi = contents.debugger
    const alreadyAttached = debuggerApi.isAttached()
    if (!alreadyAttached) {
      debuggerApi.attach('1.3')
    }

    let paints = 0
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let onPaint: () => void = () => {}
    const idle = new Promise<void>((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Website did not become idle')), 15_000)
      onPaint = () => {
        paints += 1
        clearTimeout(idleTimer)
        idleTimer = setTimeout(resolve, 5_000)
      }
    })
    const onMessage = (_event: Electron.Event, method: string) => {
      if (method === 'LayerTree.layerPainted') {
        onPaint()
      }
    }
    debuggerApi.on('message', onMessage)

    try {
      await debuggerApi.sendCommand('LayerTree.enable')
      // Positive control: the observer must detect a real paint before measuring idle.
      await contents.executeJavaScript("document.body.style.background = '#123456'")
      // Every paint restarts the full 5000 ms timer, so its expiration is the
      // quiet-window proof in the scheduler's clock. Independently sampled
      // Date.now() or performance.now() can read less at that millisecond boundary.
      await idle
      const captureInFlight = runtime.snapshotCaptureInFlight
      // Startup already requests a snapshot. Require the later idle request to create
      // a fresh image instead of letting the assertion pass on that cached image.
      runtime.snapshotDataUrl = null
      return { paints, captureInFlight }
    } finally {
      clearTimeout(idleTimer)
      clearTimeout(deadline)
      debuggerApi.removeListener('message', onMessage)
      await debuggerApi.sendCommand('LayerTree.disable')
      if (!alreadyAttached) {
        debuggerApi.detach()
      }
    }
  })
  expect(observation.paints).toBeGreaterThan(0)
  expect(observation.captureInFlight).toBe(false)
}
