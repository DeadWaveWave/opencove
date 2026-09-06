import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import path from 'node:path'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const NOTE_ID = 'pixel-close-note'
const TERMINAL_ID = 'pixel-close-terminal'
const SURVIVOR_ID = 'pixel-close-survivor'
type BurstObservation = Window & { __pixelBurstStates?: string[] }

function node(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

async function seedCloseScene(page: Page) {
  await clearAndSeedWorkspace(
    page,
    [
      {
        id: NOTE_ID,
        title: 'Close this note',
        position: { x: 150, y: 120 },
        width: 300,
        height: 200,
        kind: 'note',
        task: { text: 'Finished notes scatter into pixels.' },
      },
      {
        id: TERMINAL_ID,
        title: 'Close this terminal',
        position: { x: 550, y: 120 },
        width: 500,
        height: 280,
      },
      {
        id: SURVIVOR_ID,
        title: 'Keep working',
        position: { x: 450, y: 450 },
        width: 330,
        height: 170,
        kind: 'note',
        task: { text: 'This note remains editable.' },
      },
    ],
    { settings: { uiTheme: 'pixel', ...PIXEL_EFFECTS_ENABLED, language: 'en' } },
  )
  await expect(node(page, TERMINAL_ID).locator('.xterm')).toBeVisible()
  await expect(page.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
    'data-cove-pixel-burst',
    'idle',
  )
}

async function observeBursts(page: Page) {
  await page.evaluate(() => {
    const target = window as BurstObservation
    target.__pixelBurstStates = []
    const observer = new MutationObserver(() => {
      const state = document
        .querySelector('[data-testid="workspace-pixel-assembly"]')
        ?.getAttribute('data-cove-pixel-burst')
      if (state && target.__pixelBurstStates?.at(-1) !== state) {
        target.__pixelBurstStates?.push(state)
      }
    })
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-cove-pixel-burst'],
    })
  })
}

async function expectNoBursts(page: Page) {
  await expect(page.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
    'data-cove-pixel-burst',
    'idle',
  )
  expect(
    await page.evaluate(() => (window as BurstObservation).__pixelBurstStates ?? []),
  ).not.toContain('bursting')
}

async function readBurstSnapshot(layer: Locator, nodeId: string) {
  return await layer.evaluate((element, id) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    const pixels =
      context && canvas.width > 0 && canvas.height > 0
        ? context.getImageData(0, 0, canvas.width, canvas.height).data
        : null
    return {
      nodeRemoved: !document.querySelector(`.react-flow__node[data-id="${id}"]`),
      state: canvas.dataset.covePixelBurst,
      nodeIds: canvas.dataset.covePixelBurstNodeIds,
      painted: pixels?.some((value, index) => index % 4 === 3 && value > 0) ?? false,
    }
  }, nodeId)
}

async function attachFrame(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshotPath, animations: 'allow' })
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
}

async function closeAndObserveBurst(
  page: Page,
  testInfo: TestInfo,
  id: string,
  kind: 'note' | 'terminal',
) {
  const foreground = page.getByTestId('workspace-pixel-assembly')
  await node(page, id).locator(`.${kind}-node__close`).click()
  // Read removal and painted burst in the same browser observation, before its 420 ms expiry.
  await expect
    .poll(() => readBurstSnapshot(foreground, id), { intervals: [16, 32, 50] })
    .toEqual({ nodeRemoved: true, state: 'bursting', nodeIds: id, painted: true })
  await attachFrame(page, testInfo, `pixel-${kind}-removed-burst`)
}

test.describe('Workspace Canvas - Spatial Pixel Close', () => {
  test('removes note and terminal immediately while pixels scatter and another note stays usable', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const videoDirectory = process.env.OPENCOVE_E2E_PIXEL_CLOSE_VIDEO_DIR
    const { electronApp, window: page } = await launchApp({
      ...(videoDirectory
        ? { recordVideo: { dir: videoDirectory, size: { width: 1440, height: 900 } } }
        : {}),
    })
    const video = page.video()
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await seedCloseScene(page)
      const foreground = page.getByTestId('workspace-pixel-assembly')
      await expect(foreground).toHaveCSS('pointer-events', 'none')
      await expect(foreground).toHaveAttribute('aria-hidden', 'true')
      const survivor = node(page, SURVIVOR_ID).getByTestId('note-node-textarea')
      const survivorHandle = await survivor.elementHandle()
      await attachFrame(page, testInfo, 'pixel-close-before')
      if (videoDirectory) {
        await page.waitForTimeout(2_000)
      }

      await closeAndObserveBurst(page, testInfo, NOTE_ID, 'note')
      await survivor.click({ position: { x: 32, y: 30 } })
      await page.keyboard.insertText(' Still writing.')
      await expect(survivor).toHaveValue(/Still writing\./)
      await expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle', { timeout: 2_000 })
      await expect(node(page, NOTE_ID)).toHaveCount(0)
      if (videoDirectory) {
        await page.waitForTimeout(2_000)
      }

      await closeAndObserveBurst(page, testInfo, TERMINAL_ID, 'terminal')
      await survivor.click({ position: { x: 32, y: 30 } })
      await page.keyboard.insertText(' Terminal closed, note stays.')
      await expect(survivor).toHaveValue(/Terminal closed, note stays\./)
      expect(await survivorHandle?.evaluate(element => element.isConnected)).toBe(true)
      await expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle', { timeout: 2_000 })
      await expect(foreground).toHaveAttribute('data-cove-pixel-burst-node-ids', '')
      await expect(node(page, TERMINAL_ID)).toHaveCount(0)
      await attachFrame(page, testInfo, 'pixel-close-settled')
      if (videoDirectory) {
        await page.waitForTimeout(2_000)
      }
    } finally {
      await electronApp.close()
      if (videoDirectory && video) {
        const videoPath = path.join(videoDirectory, 'spatial-pixel-close.webm')
        await video.saveAs(videoPath)
        await testInfo.attach('spatial-pixel-close', { path: videoPath, contentType: 'video/webm' })
      }
    }
  })

  test('does not scatter pixels when deletion is canceled', async () => {
    const { electronApp, window: page } = await launchApp()
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await clearAndSeedWorkspace(
        page,
        [
          {
            id: 'pixel-cancel-task',
            title: 'Keep this task',
            position: { x: 340, y: 180 },
            width: 360,
            height: 280,
            kind: 'task',
            task: {
              requirement: 'Cancel deletion and retain the original task.',
              status: 'todo',
              linkedAgentNodeId: null,
              lastRunAt: null,
              autoGeneratedTitle: false,
            },
          },
        ],
        { settings: { uiTheme: 'pixel', ...PIXEL_EFFECTS_ENABLED } },
      )
      await observeBursts(page)
      const taskNode = node(page, 'pixel-cancel-task')
      await taskNode.getByTestId('task-node-close').click()
      const confirmation = page.getByTestId('workspace-node-delete-confirmation')
      await expect(confirmation).toBeVisible()
      await expectNoBursts(page)
      await page.getByTestId('workspace-node-delete-cancel').click()
      await expect(confirmation).toBeHidden()
      await expect(taskNode).toBeVisible()
      await expectNoBursts(page)
    } finally {
      await electronApp.close()
    }
  })

  test('closes note and terminal without scattering in reduced motion', async () => {
    const { electronApp, window: page } = await launchApp()
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await seedCloseScene(page)
      await observeBursts(page)
      await node(page, NOTE_ID).locator('.note-node__close').click()
      await expect(node(page, NOTE_ID)).toHaveCount(0)
      await node(page, TERMINAL_ID).locator('.terminal-node__close').click()
      await expect(node(page, TERMINAL_ID)).toHaveCount(0)
      await expectNoBursts(page)
      const foreground = page.getByTestId('workspace-pixel-assembly')
      expect((await readBurstSnapshot(foreground, TERMINAL_ID)).painted).toBe(false)
      const survivor = node(page, SURVIVOR_ID).getByTestId('note-node-textarea')
      await survivor.fill('Reduced motion keeps this note usable.')
      await expect(survivor).toHaveValue('Reduced motion keeps this note usable.')
    } finally {
      await electronApp.close()
    }
  })
})
