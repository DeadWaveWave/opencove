import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  clickHeaderDragSurface,
  dragLocatorTo,
  dragHeaderDragSurfaceTo,
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

      const afterDrag = await readPersistedNotePosition(
        window,
        'mouse-selected-note-body-drag-node',
      )
      if (!afterDrag) {
        throw new Error('note position unavailable after selected body drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 60)
      expect(afterDrag.y).toBeGreaterThan(beforeDrag.y + 120)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps title blank header area draggable instead of text-cursor only', async () => {
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

      const headerBox = await readLocatorClientRect(header)
      const titleBox = await readLocatorClientRect(titleDisplay)
      const inputProbe = {
        x: titleBox.x + Math.min(titleBox.width - 2, 8),
        y: titleBox.y + titleBox.height / 2,
      }
      const blankProbe = {
        x: Math.min(headerBox.x + headerBox.width - 80, titleBox.x + titleBox.width + 80),
        y: headerBox.y + headerBox.height / 2,
      }

      const cursors = await window.evaluate(
        ({ input, blank }) => {
          const readCursorAt = (point: { x: number; y: number }): string | null => {
            const element = document.elementFromPoint(point.x, point.y)
            return element ? window.getComputedStyle(element).cursor : null
          }

          return {
            input: readCursorAt(input),
            blank: readCursorAt(blank),
          }
        },
        { input: inputProbe, blank: blankProbe },
      )

      expect(cursors.input).toBe('text')
      expect(cursors.blank).not.toBe('text')

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
        throw new Error('note position unavailable before title blank drag')
      }

      await expect(pane).toBeVisible()
      await dragHeaderDragSurfaceTo(window, header, pane, {
        sourcePosition: {
          x: blankProbe.x - headerBox.x,
          y: blankProbe.y - headerBox.y,
        },
        targetPosition: { x: 760, y: 520 },
      })

      const afterDrag = await readPersistedNotePosition(window, 'note-title-blank-drag-node')
      if (!afterDrag) {
        throw new Error('note position unavailable after title blank drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 120)
      expect(afterDrag.y).toBeGreaterThan(beforeDrag.y + 120)
    } finally {
      await electronApp.close()
    }
  })
})
