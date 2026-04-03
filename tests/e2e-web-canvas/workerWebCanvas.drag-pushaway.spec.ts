import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  invokeValue,
  openAuthedCanvas,
  writeAppState,
} from './helpers'

test.describe('Worker web canvas drag projection', () => {
  test('keeps push-away projection during drag while sync refreshes apply', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('drag-pushaway')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-a', 'note-b'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-a',
            title: 'A',
            kind: 'note',
            position: { x: 80, y: 120 },
            width: 280,
            height: 220,
            text: 'drag-source',
          },
          {
            id: 'note-b',
            title: 'B',
            kind: 'note',
            position: { x: 420, y: 120 },
            width: 280,
            height: 220,
            text: 'collision-target',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const noteA = page.locator('.react-flow__node[data-id="note-a"]')
    const noteB = page.locator('.react-flow__node[data-id="note-b"]')
    await expect(noteA).toBeVisible()
    await expect(noteB).toBeVisible()

    const beforeA = await noteA.boundingBox()
    const beforeB = await noteB.boundingBox()
    expect(beforeA).toBeTruthy()
    expect(beforeB).toBeTruthy()

    const dragHandle = noteA.locator('[data-node-drag-handle=true]')
    await expect(dragHandle).toBeVisible()
    const handleBox = await dragHandle.boundingBox()
    expect(handleBox).toBeTruthy()

    const deltaX = beforeB!.x - beforeA!.x + beforeB!.width * 0.35
    const startPoint = {
      x: handleBox!.x + handleBox!.width / 2,
      y: handleBox!.y + handleBox!.height / 2,
    }

    await page.mouse.move(startPoint.x, startPoint.y)
    await page.mouse.down()

    try {
      await page.mouse.move(startPoint.x + deltaX, startPoint.y, { steps: 6 })

      await invokeValue(page.request, 'command', 'note.create', {
        spaceId: 'space-1',
        text: `external-refresh-${Date.now()}`,
        x: 900,
        y: 520,
      })

      await expect(page.locator('[data-testid="note-node-textarea"]')).toHaveCount(3)

      const duringDragB = await noteB.boundingBox()
      expect(duringDragB).toBeTruthy()

      const dx = Math.abs(duringDragB!.x - beforeB!.x)
      const dy = Math.abs(duringDragB!.y - beforeB!.y)
      expect(Math.max(dx, dy)).toBeGreaterThan(12)
    } finally {
      await page.mouse.up().catch(() => undefined)
    }
  })
})
