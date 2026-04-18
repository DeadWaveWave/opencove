import { expect, test, type Locator, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readLocatorClientRect } from './workspace-canvas.helpers'

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
  const end = {
    x: start.x + (delta.x ?? 0),
    y: start.y + (delta.y ?? 0),
  }

  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  await window.waitForTimeout(40)
  await window.mouse.move(end.x, end.y, { steps: 16 })
  await window.mouse.move(end.x, end.y)
  await window.waitForTimeout(60)
  await window.mouse.up()
  await window.waitForTimeout(40)
}

async function readPersistedNodeFrame(
  window: Page,
  nodeId: string,
): Promise<{ width: number; height: number } | null> {
  return await window.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as {
        workspaces?: Array<{
          nodes?: Array<{
            id?: string
            width?: number
            height?: number
          }>
        }>
      }
      const node = parsed.workspaces?.[0]?.nodes?.find(item => item.id === id)
      if (typeof node?.width !== 'number' || typeof node.height !== 'number') {
        return null
      }

      return {
        width: node.width,
        height: node.height,
      }
    } catch {
      return null
    }
  }, nodeId)
}

async function shrinkRowsUntilLessThan(
  window: Page,
  resizer: Locator,
  readRows: () => Promise<number>,
  targetRows: number,
  readNodeHeight: () => Promise<number>,
  targetNodeHeight: number,
  offsets: number[],
): Promise<{ rows: number; nodeHeight: number }> {
  const tryOffset = async (index: number): Promise<{ rows: number; nodeHeight: number }> => {
    if (index >= offsets.length) {
      return {
        rows: await readRows(),
        nodeHeight: await readNodeHeight(),
      }
    }

    await dragResizerBy(window, resizer, { y: offsets[index] })

    try {
      await expect
        .poll(
          async () => {
            const rows = await readRows()
            const nodeHeight = await readNodeHeight()
            return rows < targetRows || nodeHeight < targetNodeHeight
          },
          { timeout: 3_000 },
        )
        .toBe(true)
      return {
        rows: await readRows(),
        nodeHeight: await readNodeHeight(),
      }
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
      const readNodeHeight = async () => (await readPersistedNodeFrame(window, nodeId))?.height ?? 0

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
      const viewportHeight = await window.evaluate(() => window.innerHeight)
      const bottomResizerRect = await readLocatorClientRect(bottomResizer)
      const maxVisibleExpandDelta = Math.floor(viewportHeight - bottomResizerRect.y - 24)
      expect(
        maxVisibleExpandDelta,
        `Expected terminal bottom resizer to have visible room before vertical expansion, but only ${maxVisibleExpandDelta}px remained`,
      ).toBeGreaterThan(48)
      await dragResizerBy(window, bottomResizer, { y: Math.min(160, maxVisibleExpandDelta) })

      await expect
        .poll(async () => (await readSize())?.rows ?? 0)
        .toBeGreaterThan(beforeHeightSize.rows)
      const expandedHeightSize = (await readSize())!
      const expandedNodeHeight = await readNodeHeight()

      const shrinkResult = await shrinkRowsUntilLessThan(
        window,
        bottomResizer,
        async () => (await readSize())?.rows ?? Number.POSITIVE_INFINITY,
        expandedHeightSize.rows,
        readNodeHeight,
        expandedNodeHeight,
        [-220, -320, -420],
      )

      expect(
        shrinkResult.nodeHeight,
        `Expected terminal node height to shrink after resizing smaller, but sampled height was ${shrinkResult.nodeHeight} and expanded height was ${expandedNodeHeight}`,
      ).toBeLessThan(expandedNodeHeight)
      expect(shrinkResult.rows).toBeLessThanOrEqual(expandedHeightSize.rows)
    } finally {
      await electronApp.close()
    }
  })
})
