import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
} from './workspace-canvas.helpers'

type AssemblyObservation = Window & { __pixelAssemblyStates?: string[] }

async function observeAssembly(window: Page) {
  await window.addInitScript(() => {
    const target = window as AssemblyObservation
    target.__pixelAssemblyStates = []
    const observer = new MutationObserver(() => {
      const state = document
        .querySelector('[data-testid="workspace-pixel-assembly"]')
        ?.getAttribute('data-cove-pixel-assembly')
      if (state && target.__pixelAssemblyStates?.at(-1) !== state) {
        target.__pixelAssemblyStates?.push(state)
      }
    })
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-cove-pixel-assembly'],
    })
  })
}

async function readAssemblyStates(window: Page) {
  return await window.evaluate(() => (window as AssemblyObservation).__pixelAssemblyStates ?? [])
}

async function fieldSignature(layer: Locator) {
  const image = await layer.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  return createHash('sha256').update(image).digest('hex')
}

async function expectPaintedField(layer: Locator) {
  await expect(layer).toBeVisible()
  await expect
    .poll(() =>
      layer.evaluate(canvas => {
        const surface = canvas as HTMLCanvasElement
        if (surface.width === 0 || surface.height === 0) {
          return false
        }
        return surface
          .getContext('2d')
          ?.getImageData(0, 0, surface.width, surface.height)
          .data.some((value, index) => index % 4 === 3 && value > 0)
      }),
    )
    .toBe(true)
}

async function createNode(window: Page, kind: 'note' | 'terminal', x: number, y: number) {
  await window
    .locator('.workspace-canvas .react-flow__pane')
    .click({ button: 'right', position: { x, y } })
  await window.getByTestId(`workspace-context-new-${kind}`).click()
}

async function attachFrame(window: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await window.screenshot({ animations: 'allow' }),
    contentType: 'image/png',
  })
}

async function expectPersistedNote(window: Page, value: string) {
  await expect
    .poll(() =>
      window.evaluate(async text => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return false
        }
        const state = JSON.parse(raw) as {
          workspaces?: Array<{ nodes?: Array<{ kind?: string; task?: { text?: string } }> }>
        }
        return state.workspaces?.some(workspace =>
          workspace.nodes?.some(node => node.kind === 'note' && node.task?.text === text),
        )
      }, value),
    )
    .toBe(true)
}

test.describe('Workspace Canvas - Spatial Pixel Motion', () => {
  test('flows while idle and assembles new nodes without blocking input or replaying on reload', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const videoDirectory = process.env.OPENCOVE_E2E_PIXEL_VIDEO_DIR
    const { electronApp, window } = await launchApp({
      ...(videoDirectory
        ? { recordVideo: { dir: videoDirectory, size: { width: 1440, height: 900 } } }
        : {}),
    })
    const video = window.video()
    try {
      await observeAssembly(window)
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      await clearAndSeedWorkspace(window, [], { settings: { uiTheme: 'pixel', language: 'en' } })
      const layer = window.getByTestId('workspace-pixel-layer')
      const assembly = window.getByTestId('workspace-pixel-assembly')
      await expectPaintedField(layer)
      await expect(layer).toHaveAttribute('data-cove-pixel-activity', 'idle')
      const viewport = await readCanvasViewport(window)
      const first = await fieldSignature(layer)
      // Sample elapsed visual time without triggering output, input or viewport changes.
      await window.waitForTimeout(350)
      const second = await fieldSignature(layer)
      await window.waitForTimeout(350)
      const third = await fieldSignature(layer)
      expect(new Set([first, second, third]).size).toBe(3)
      expect(await readCanvasViewport(window)).toEqual(viewport)
      await expect(layer).toHaveAttribute('data-cove-pixel-activity', 'idle')
      await attachFrame(window, testInfo, 'pixel-idle-field')
      // Keep a clear two-second idle segment in the optional real application recording.
      if (videoDirectory) {
        await window.waitForTimeout(2_000)
      }

      await createNode(window, 'note', 200, 180)
      await expect(assembly).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
      await expect(assembly).toHaveCSS('pointer-events', 'none')
      await expect(assembly).toHaveAttribute('aria-hidden', 'true')
      const note = window.getByTestId('note-node-textarea')
      await expect(note).toBeEditable()
      const noteId = await note.evaluate(element =>
        element.closest('.react-flow__node')?.getAttribute('data-id'),
      )
      await expect(assembly).toHaveAttribute('data-cove-pixel-node-ids', noteId ?? '')
      await attachFrame(window, testInfo, 'pixel-note-assembly')
      // The first input immediately reveals the node, so typing never waits for the effect.
      await expect(assembly).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
      await note.click({ position: { x: 36, y: 30 } })
      await window.keyboard.insertText('Ready to write while pixels settle.')
      await expect(note).toHaveValue('Ready to write while pixels settle.')
      await expect(assembly).toHaveAttribute('data-cove-pixel-assembly', 'idle')
      await expectPersistedNote(window, 'Ready to write while pixels settle.')

      await createNode(window, 'terminal', 680, 80)
      await expect(assembly).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
      await attachFrame(window, testInfo, 'pixel-terminal-assembly')
      const terminal = window.locator('.terminal-node').first()
      await expect(terminal.locator('.xterm')).toBeVisible()
      const instance = await terminal.locator('.xterm').elementHandle()
      await expect(assembly).toHaveAttribute('data-cove-pixel-assembly', 'idle', { timeout: 2_000 })
      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      const command =
        process.platform === 'win32'
          ? buildNodeEvalCommand("process.stdout.write(['PIXEL', 'READY'].join('_') + '\\n')")
          : "printf '%s_%s\\n' 'PIXEL' 'READY'"
      await window.keyboard.type(command)
      await window.keyboard.press('Enter')
      // The marker is assembled by the shell and cannot be satisfied by echoed command text.
      await expect(terminal).toContainText('PIXEL_READY')
      expect(await instance?.evaluate(element => element.isConnected)).toBe(true)
      await attachFrame(window, testInfo, 'pixel-new-nodes-ready')
      if (videoDirectory) {
        await window.waitForTimeout(2_000)
      }

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(note).toHaveValue('Ready to write while pixels settle.')
      await expect(terminal.locator('.xterm')).toBeVisible()
      await expect(assembly).toHaveAttribute('data-cove-pixel-assembly', 'idle')
      await window.waitForTimeout(850)
      expect(await readAssemblyStates(window)).not.toContain('assembling')
    } finally {
      await electronApp.close()
      if (videoDirectory && video) {
        const videoPath = path.join(videoDirectory, 'spatial-pixel-motion.webm')
        await video.saveAs(videoPath)
        await testInfo.attach('spatial-pixel-motion', {
          path: videoPath,
          contentType: 'video/webm',
        })
      }
    }
  })

  test('keeps reduced-motion pixels static and creates immediately usable nodes without assembly', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await observeAssembly(window)
      await window.emulateMedia({ reducedMotion: 'reduce' })
      await clearAndSeedWorkspace(window, [], { settings: { uiTheme: 'pixel' } })
      const layer = window.getByTestId('workspace-pixel-layer')
      const assembly = window.getByTestId('workspace-pixel-assembly')
      await expectPaintedField(layer)
      await expect(layer).toHaveAttribute('data-cove-pixel-motion', 'static')
      const before = await fieldSignature(layer)
      await window.waitForTimeout(500)
      expect(await fieldSignature(layer)).toBe(before)
      await createNode(window, 'note', 240, 180)
      const note = window.getByTestId('note-node-textarea')
      await note.fill('Reduced motion is ready immediately.')
      await expect(note).toHaveValue('Reduced motion is ready immediately.')
      await expect(assembly).toHaveAttribute('data-cove-pixel-assembly', 'idle')
      expect(await readAssemblyStates(window)).not.toContain('assembling')
      await attachFrame(window, testInfo, 'pixel-reduced-motion-note')
    } finally {
      await electronApp.close()
    }
  })
})
