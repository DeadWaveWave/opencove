import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readLocatorClientRect,
} from './workspace-canvas.helpers'

async function dragResizerBy(
  window: Page,
  resizer: Locator,
  delta: { x?: number; y?: number },
): Promise<void> {
  const rect = await readLocatorClientRect(resizer)
  const start = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }

  await dragMouse(window, {
    start,
    end: {
      x: start.x + (delta.x ?? 0),
      y: start.y + (delta.y ?? 0),
    },
    steps: 12,
  })
}

async function shrinkRowsUntilLessThan(
  window: Page,
  resizer: Locator,
  readRows: () => Promise<number>,
  targetRows: number,
  offsets: number[],
): Promise<number> {
  const tryOffset = async (index: number): Promise<number> => {
    if (index >= offsets.length) {
      return await readRows()
    }

    await dragResizerBy(window, resizer, { y: offsets[index] })

    try {
      await expect.poll(readRows, { timeout: 3_000 }).toBeLessThan(targetRows)
      return await readRows()
    } catch {
      return await tryOffset(index + 1)
    }
  }

  return await tryOffset(0)
}

test.describe('Workspace Canvas - Terminal resize shrink', () => {
  test('reflows terminal when resizing smaller after expanding', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const nodeId = 'terminal-resize-shrink'

      await clearAndSeedWorkspace(window, [
        {
          id: nodeId,
          title: nodeId,
          position: { x: 160, y: 140 },
          width: 680,
          height: 360,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const readSize = async () => {
        return await window.evaluate(id => {
          return window.__opencoveTerminalSelectionTestApi?.getSize?.(id) ?? null
        }, nodeId)
      }

      await expect.poll(readSize).toBeTruthy()
      const initialSize = (await readSize())!

      const rightResizer = terminal.locator('[data-testid="terminal-resizer-right"]')
      await expect(rightResizer).toBeVisible()
      await dragResizerBy(window, rightResizer, { x: 240 })

      await expect.poll(async () => (await readSize())?.cols ?? 0).toBeGreaterThan(initialSize.cols)
      const expandedWidthSize = (await readSize())!

      await dragResizerBy(window, rightResizer, { x: -320 })

      await expect
        .poll(async () => (await readSize())?.cols ?? Number.POSITIVE_INFINITY)
        .toBeLessThan(expandedWidthSize.cols)

      const bottomResizer = terminal.locator('[data-testid="terminal-resizer-bottom"]')
      await expect(bottomResizer).toBeVisible()

      const beforeHeightSize = (await readSize())!
      await dragResizerBy(window, bottomResizer, { y: 160 })

      await expect
        .poll(async () => (await readSize())?.rows ?? 0)
        .toBeGreaterThan(beforeHeightSize.rows)
      const expandedHeightSize = (await readSize())!

      const shrunkRows = await shrinkRowsUntilLessThan(
        window,
        bottomResizer,
        async () => (await readSize())?.rows ?? Number.POSITIVE_INFINITY,
        expandedHeightSize.rows,
        [-220, -320, -420],
      )

      expect(
        shrunkRows,
        `Expected terminal rows to shrink after resizing smaller, but sampled rows were ${shrunkRows} and expanded rows were ${expandedHeightSize.rows}`,
      ).toBeLessThan(expandedHeightSize.rows)
    } finally {
      await electronApp.close()
    }
  })
})
