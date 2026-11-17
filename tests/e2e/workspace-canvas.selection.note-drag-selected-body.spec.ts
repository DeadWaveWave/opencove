import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  clickHeaderDragSurface,
  dragLocatorTo,
  launchApp,
  readLocatorClientRect,
  storageKey,
} from './workspace-canvas.helpers'

async function readPersistedNotePosition(
  window: Page,
  nodeId: string,
): Promise<{ x: number; y: number } | null> {
  return await window.evaluate(
    async ({ key, id }) => {
      void key

      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      if (!raw) {
        return null
      }

      const state = JSON.parse(raw) as {
        workspaces?: Array<{
          nodes?: Array<{
            id: string
            position?: { x?: number; y?: number }
          }>
        }>
      }

      const node = state.workspaces?.[0]?.nodes?.find(entry => entry.id === id)
      if (
        !node?.position ||
        typeof node.position.x !== 'number' ||
        typeof node.position.y !== 'number'
      ) {
        return null
      }

      return {
        x: node.position.x,
        y: node.position.y,
      }
    },
    { key: storageKey, id: nodeId },
  )
}

// The release reaches the saved state through the debounced persistence write, so a read taken
// right after the mouse-up can still see the position from before the drag: poll until it moves.
async function expectPersistedNoteMovedBy(
  window: Page,
  nodeId: string,
  before: { x: number; y: number },
  minimum: { x: number; y: number },
): Promise<void> {
  const movedBy = async (axis: 'x' | 'y'): Promise<number | null> => {
    const after = await readPersistedNotePosition(window, nodeId)
    return after ? after[axis] - before[axis] : null
  }
  await expect.poll(() => movedBy('x')).toBeGreaterThan(minimum.x)
  await expect.poll(() => movedBy('y')).toBeGreaterThan(minimum.y)
}

test.describe('Workspace Canvas - Selection (Note Drag)', () => {
  test('drags a selected note from textarea body', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-selected-note-body-drag-node',
            title: 'note',
            position: { x: 240, y: 220 },
            width: 420,
            height: 280,
            kind: 'note',
            task: {
              text: 'selected note drag body',
            },
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const noteNode = window.locator('.note-node').first()
      const header = noteNode.locator('.note-node__header')
      const textarea = noteNode.locator('[data-testid="note-node-textarea"]')
      await expect(header).toBeVisible()
      await expect(textarea).toBeVisible()

      await window.keyboard.down('Shift')
      try {
        await clickHeaderDragSurface(header, { modifiers: ['Shift'] })
      } finally {
        await window.keyboard.up('Shift')
      }
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(window.locator('.workspace-canvas')).toHaveAttribute(
        'data-cove-drag-surface-selection-mode',
        'true',
      )

      const beforeDrag = await readPersistedNotePosition(
        window,
        'mouse-selected-note-body-drag-node',
      )
      if (!beforeDrag) {
        throw new Error('note position unavailable before selected body drag')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await dragLocatorTo(window, textarea, pane, {
        sourcePosition: { x: 120, y: 60 },
        targetPosition: { x: 760, y: 520 },
      })

      await expectPersistedNoteMovedBy(window, 'mouse-selected-note-body-drag-node', beforeDrag, {
        x: 60,
        y: 120,
      })
    } finally {
      await electronApp.close()
    }
  })

  test('moves the note from a drag on its title, never from its open title input', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'note-title-blank-drag-node',
            title: 'note',
            position: { x: 240, y: 220 },
            width: 420,
            height: 280,
            kind: 'note',
            task: {
              text: 'title blank drag',
            },
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const noteNode = window.locator('.note-node').first()
      const header = noteNode.locator('.note-node__header')
      const titleDisplay = noteNode.locator('[data-testid="note-node-title-display"]')
      await expect(header).toBeVisible()
      await expect(titleDisplay).toBeVisible()

      const titleBox = await readLocatorClientRect(titleDisplay)
      const inputProbe = {
        x: titleBox.x + Math.min(titleBox.width - 2, 8),
        y: titleBox.y + titleBox.height / 2,
      }

      // The title is part of the drag surface: it shows the bar's grab cursor, a click renames
      // it, and a drag on it moves the note.
      const cursor = await window.evaluate(point => {
        const element = document.elementFromPoint(point.x, point.y)
        return element ? window.getComputedStyle(element).cursor : null
      }, inputProbe)
      expect(cursor).toBe('grab')

      await titleDisplay.click()
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      const titleInput = noteNode.locator('[data-testid="note-node-title-input"]')
      await expect(titleInput).toBeVisible()

      const beforeInputDrag = await readPersistedNotePosition(window, 'note-title-blank-drag-node')
      if (!beforeInputDrag) {
        throw new Error('note position unavailable before title input drag')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await dragLocatorTo(window, titleInput, pane, {
        sourcePosition: { x: 8, y: 10 },
        targetPosition: { x: 760, y: 520 },
      })

      const afterInputDrag = await readPersistedNotePosition(window, 'note-title-blank-drag-node')
      if (!afterInputDrag) {
        throw new Error('note position unavailable after title input drag')
      }

      expect(afterInputDrag).toEqual(beforeInputDrag)

      await titleInput.press('Escape')
      await expect(titleDisplay).toBeVisible()

      const beforeDrag = await readPersistedNotePosition(window, 'note-title-blank-drag-node')
      if (!beforeDrag) {
        throw new Error('note position unavailable before title drag')
      }

      await expect(pane).toBeVisible()
      await dragLocatorTo(window, titleDisplay, pane, {
        sourcePosition: { x: inputProbe.x - titleBox.x, y: titleBox.height / 2 },
        targetPosition: { x: 760, y: 520 },
      })

      await expect(titleInput).toHaveCount(0)
      await expectPersistedNoteMovedBy(window, 'note-title-blank-drag-node', beforeDrag, {
        x: 120,
        y: 120,
      })
    } finally {
      await electronApp.close()
    }
  })
})
