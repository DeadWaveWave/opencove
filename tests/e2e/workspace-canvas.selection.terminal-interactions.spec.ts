import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragLocatorTo,
  launchApp,
  selectCoveOption,
  storageKey,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection', () => {
  test('toggles node selection with shift-click on terminal headers in mouse mode', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-shift-click-node-a',
            title: 'terminal-mouse-shift-click-a',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
          {
            id: 'mouse-shift-click-node-b',
            title: 'terminal-mouse-shift-click-b',
            position: { x: 760, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const firstNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-mouse-shift-click-a' })
        .first()
      const secondNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-mouse-shift-click-b' })
        .first()

      const firstHeader = firstNode.locator('.terminal-node__header')
      const secondHeader = secondNode.locator('.terminal-node__header')
      await expect(firstHeader).toBeVisible()
      await expect(secondHeader).toBeVisible()

      await firstHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await window.keyboard.down('Shift')
      await secondHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)

      const firstHeaderBox = await firstHeader.boundingBox()
      if (!firstHeaderBox) {
        throw new Error('first header bounding box unavailable')
      }

      await window.mouse.move(firstHeaderBox.x + 40, firstHeaderBox.y + 20)
      await window.mouse.down()
      await window.mouse.up()
      await window.keyboard.up('Shift')

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-mouse-shift-click-b')
    } finally {
      await electronApp.close()
    }
  })

  test('keeps terminal body clicks focus-only unless shift is pressed', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-terminal-focus-node',
            title: 'terminal-mouse-focus-only',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const terminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-focus-only' })
        .first()
      const header = terminal.locator('.terminal-node__header')
      const terminalBody = terminal.locator('.terminal-node__terminal')

      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      await expect(settingsButton).toBeVisible()
      await settingsButton.click({ noWaitAfter: true })

      const languageSelect = window.locator('[data-testid="settings-language"]')
      const languageTrigger = window.locator('[data-testid="settings-language-trigger"]')
      await expect(languageTrigger).toBeVisible()
      await selectCoveOption(window, 'settings-language', 'zh-CN')
      await expect(languageSelect).toHaveValue('zh-CN')
      await expect(settingsButton).toHaveAttribute('aria-label', '设置')

      await window.locator('.settings-panel__close').click()
      await expect(settingsButton).toHaveAttribute('aria-label', '设置')
      await expect(terminalBody).toBeVisible()

      await header.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await pane.click({ position: { x: 40, y: 40 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      await terminalBody.click({ position: { x: 48, y: 48 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
      await expect(window.locator('.workspace-selection-hint')).toHaveCount(0)

      await terminalBody.click({ position: { x: 56, y: 56 }, modifiers: ['Shift'] })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(window.locator('.workspace-selection-hint')).toContainText('已选中 1 个窗口。')
    } finally {
      await electronApp.close()
    }
  })

  test('drags a selected terminal from the header after body selection', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-selected-drag-node',
            title: 'terminal-mouse-selected-drag',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const terminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-selected-drag' })
        .first()
      const header = terminal.locator('.terminal-node__header')
      const terminalBody = terminal.locator('.terminal-node__terminal')
      await expect(header).toBeVisible()

      await header.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await pane.click({ position: { x: 40, y: 40 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      await expect(terminalBody).toBeVisible()
      await terminalBody.click({ position: { x: 56, y: 56 }, modifiers: ['Shift'] })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      const readNodePosition = async (): Promise<{ x: number; y: number } | null> => {
        return await window.evaluate(async key => {
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

          const node = state.workspaces?.[0]?.nodes?.find(
            entry => entry.id === 'mouse-selected-drag-node',
          )

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
        }, storageKey)
      }

      const beforeDrag = await readNodePosition()
      if (!beforeDrag) {
        throw new Error('node position unavailable before selected overlay drag')
      }

      const headerBox = await header.boundingBox()
      const paneBox = await pane.boundingBox()
      if (!headerBox || !paneBox) {
        throw new Error('header or pane bounding box unavailable')
      }

      const startX = headerBox.x + 140
      const startY = headerBox.y + 20
      const endX = paneBox.x + 760
      const endY = paneBox.y + 520

      await window.mouse.move(startX, startY)
      await window.mouse.down()
      await window.mouse.move(endX, endY, { steps: 12 })

      await expect(terminal).toHaveClass(/terminal-node--selected-surface/)

      await window.mouse.up()

      const afterDrag = await readNodePosition()
      if (!afterDrag) {
        throw new Error('node position unavailable after selected overlay drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 120)
      expect(afterDrag.y).toBeGreaterThan(beforeDrag.y + 120)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps header drag after shift marquee selects a single terminal', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-marquee-drag-node',
            title: 'terminal-mouse-marquee-drag',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.workspace-canvas')).toHaveAttribute(
        'data-canvas-input-mode',
        'mouse',
      )
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable for marquee drag')
      }

      const terminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-marquee-drag' })
        .first()
      await expect(terminal).toBeVisible()
      const terminalBox = await terminal.boundingBox()
      if (!terminalBox) {
        throw new Error('terminal bounding box unavailable for marquee drag')
      }

      const startX = Math.max(paneBox.x + 40, terminalBox.x - 24)
      const startY = Math.max(paneBox.y + 40, terminalBox.y - 24)
      const endX = Math.min(paneBox.x + paneBox.width - 40, terminalBox.x + terminalBox.width - 24)
      const endY = Math.min(
        paneBox.y + paneBox.height - 120,
        terminalBox.y + terminalBox.height - 24,
      )

      await pane.click({ position: { x: 40, y: 40 } })
      await window.keyboard.down('Shift')
      await window.mouse.move(startX, startY)
      await window.mouse.down()
      await window.mouse.move(endX, endY, { steps: 10 })
      await expect(window.locator('.workspace-selection-draft')).toBeVisible()
      await window.mouse.up()
      await window.keyboard.up('Shift')

      await expect(window.locator('.workspace-selection-draft')).toHaveCount(0)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      const readNodePosition = async (): Promise<{ x: number; y: number } | null> => {
        return await window.evaluate(async key => {
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

          const node = state.workspaces?.[0]?.nodes?.find(
            entry => entry.id === 'mouse-marquee-drag-node',
          )

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
        }, storageKey)
      }

      const beforeDrag = await readNodePosition()
      if (!beforeDrag) {
        throw new Error('node position unavailable before marquee drag')
      }

      const header = terminal.locator('.terminal-node__header')
      await dragLocatorTo(window, header, pane, {
        sourcePosition: { x: 140, y: 16 },
        targetPosition: { x: 760, y: 80 },
      })

      const afterDrag = await readNodePosition()
      if (!afterDrag) {
        throw new Error('node position unavailable after marquee drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 120)
      expect(afterDrag.y).toBeLessThan(beforeDrag.y - 40)
    } finally {
      await electronApp.close()
    }
  })

  test('switches selected window on terminal header click without moving canvas', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-window-switch-node-a',
            title: 'terminal-mouse-window-switch-a',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
          {
            id: 'mouse-window-switch-node-b',
            title: 'terminal-mouse-window-switch-b',
            position: { x: 760, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const firstNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-mouse-window-switch-a' })
        .first()
      const secondNode = window
        .locator('.react-flow__node')
        .filter({ hasText: 'terminal-mouse-window-switch-b' })
        .first()

      const firstHeader = firstNode.locator('.terminal-node__header')
      const secondHeader = secondNode.locator('.terminal-node__header')
      await expect(firstHeader).toBeVisible()
      await expect(secondHeader).toBeVisible()

      await firstHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-mouse-window-switch-a')

      await secondHeader.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected .terminal-node__title').first(),
      ).toContainText('terminal-mouse-window-switch-b')
    } finally {
      await electronApp.close()
    }
  })
})
