import { expect, test, type Page } from '@playwright/test'
import {
  resolveDefaultNoteWindowSize,
  resolveDefaultTerminalWindowSize,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  readWorkspaceViewState,
  seededWorkspaceId,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const commandModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

interface PersistedWorkspaceSnapshot {
  id: string
  activeSpaceId: string | null
  nodes: Array<{
    id: string
    kind: string
    position: { x: number; y: number }
    expectedDirectory?: string | null
  }>
  spaces: Array<{
    id: string
    nodeIds: string[]
  }>
}

async function readPersistedWorkspace(window: Page): Promise<PersistedWorkspaceSnapshot | null> {
  return await window.evaluate(async targetWorkspaceId => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as {
      workspaces?: Array<{
        id: string
        activeSpaceId: string | null
        nodes: Array<{
          id: string
          kind: string
          position: { x: number; y: number }
          expectedDirectory?: string | null
        }>
        spaces: Array<{
          id: string
          nodeIds: string[]
        }>
      }>
    }

    return parsed.workspaces?.find(workspace => workspace.id === targetWorkspaceId) ?? null
  }, seededWorkspaceId)
}

async function readCanvasMetrics(window: Page): Promise<{
  width: number
  height: number
  windowWidth: number
  windowHeight: number
}> {
  return await window.evaluate(() => {
    const surface = document.querySelector('.workspace-canvas .react-flow')
    if (!(surface instanceof HTMLElement)) {
      throw new Error('react-flow surface size unavailable')
    }

    return {
      width: surface.clientWidth,
      height: surface.clientHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    }
  })
}

async function focusWorkspaceCanvas(window: Page): Promise<void> {
  await window.evaluate(() => {
    const { activeElement } = document
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }

    const canvas = document.querySelector('.workspace-canvas')
    if (canvas instanceof HTMLElement) {
      canvas.focus({ preventScroll: true })
    }
  })

  await expect
    .poll(async () => {
      return await window.evaluate(() => {
        return (
          document.activeElement instanceof HTMLElement &&
          document.activeElement.classList.contains('workspace-canvas')
        )
      })
    })
    .toBe(true)

  await window.waitForTimeout(50)
}

test.describe('Workspace Canvas - Shortcuts', () => {
  test('creates a space from the selected nodes via shortcut', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'shortcut-space-node',
          title: 'terminal-shortcut-space',
          position: { x: 160, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      await window
        .locator('.terminal-node__header')
        .first()
        .click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await focusWorkspaceCanvas(window)
      await window.keyboard.press(`${commandModifier}+G`)

      await expect
        .poll(
          async () => {
            const workspace = await readPersistedWorkspace(window)
            return workspace?.spaces ?? []
          },
          { timeout: 30_000 },
        )
        .toHaveLength(1)

      const workspace = await readPersistedWorkspace(window)
      expect(workspace?.spaces[0]?.nodeIds).toEqual(['shortcut-space-node'])
    } finally {
      await electronApp.close()
    }
  })

  test('creates a note from the visual center of the root canvas via shortcut', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const viewport = await readCanvasViewport(window)
      const metrics = await readCanvasMetrics(window)
      const centerFlowX = -viewport.x / viewport.zoom + metrics.width / (2 * viewport.zoom)
      const centerFlowY = -viewport.y / viewport.zoom + metrics.height / (2 * viewport.zoom)
      const noteSize = resolveDefaultNoteWindowSize('regular')

      await window.keyboard.press(`${commandModifier}+N`)

      await expect
        .poll(async () => {
          const workspace = await readPersistedWorkspace(window)
          return workspace?.nodes.length ?? 0
        })
        .toBe(1)

      const workspace = await readPersistedWorkspace(window)
      const note = workspace?.nodes[0]
      expect(note?.kind).toBe('note')
      expect(note?.position.x).toBeCloseTo(centerFlowX - noteSize.width / 2, 0)
      expect(note?.position.y).toBeCloseTo(centerFlowY - noteSize.height / 2, 0)
    } finally {
      await electronApp.close()
    }
  })

  test('creates a terminal from the visual center of the root canvas via shortcut', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const viewport = await readCanvasViewport(window)
      const metrics = await readCanvasMetrics(window)
      const centerFlowX = -viewport.x / viewport.zoom + metrics.width / (2 * viewport.zoom)
      const centerFlowY = -viewport.y / viewport.zoom + metrics.height / (2 * viewport.zoom)
      const terminalSize = resolveDefaultTerminalWindowSize('regular')

      await window.keyboard.press(`${commandModifier}+T`)

      await expect
        .poll(async () => {
          const workspace = await readPersistedWorkspace(window)
          return workspace?.nodes.length ?? 0
        })
        .toBe(1)

      const workspace = await readPersistedWorkspace(window)
      const terminal = workspace?.nodes[0]
      expect(terminal?.kind).toBe('terminal')
      expect(terminal?.expectedDirectory).toBe(testWorkspacePath)
      expect(terminal?.position.x).toBeCloseTo(centerFlowX - terminalSize.width / 2, 0)
      expect(terminal?.position.y).toBeCloseTo(centerFlowY - terminalSize.height / 2, 0)
    } finally {
      await electronApp.close()
    }
  })

  test('cycles spaces in pill order without All via bracket shortcuts', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-cycle-node-1',
            title: 'note-cycle-1',
            position: { x: 120, y: 120 },
            width: 320,
            height: 220,
            kind: 'note',
            task: { text: 'first' },
          },
          {
            id: 'space-cycle-node-2',
            title: 'note-cycle-2',
            position: { x: 1640, y: 1040 },
            width: 320,
            height: 220,
            kind: 'note',
            task: { text: 'second' },
          },
        ],
        {
          spaces: [
            {
              id: 'space-cycle-1',
              name: 'Alpha',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-cycle-node-1'],
              rect: { x: 80, y: 80, width: 420, height: 320 },
            },
            {
              id: 'space-cycle-2',
              name: 'Beta',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-cycle-node-2'],
              rect: { x: 1600, y: 1000, width: 420, height: 320 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await focusWorkspaceCanvas(window)
      await window.keyboard.press(`${commandModifier}+]`)
      await expect
        .poll(async () => (await readWorkspaceViewState(window, seededWorkspaceId))?.activeSpaceId)
        .toBe('space-cycle-1')

      await window.keyboard.press(`${commandModifier}+]`)
      await expect
        .poll(async () => (await readWorkspaceViewState(window, seededWorkspaceId))?.activeSpaceId)
        .toBe('space-cycle-2')

      await window.keyboard.press(`${commandModifier}+[`)
      await expect
        .poll(async () => (await readWorkspaceViewState(window, seededWorkspaceId))?.activeSpaceId)
        .toBe('space-cycle-1')
    } finally {
      await electronApp.close()
    }
  })

  test('does not capture workspace shortcuts while terminal is focused by default', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'terminal-focus-shortcuts',
            title: 'terminal-focus-shortcuts',
            position: { x: 120, y: 120 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            disableAppShortcutsWhenTerminalFocused: true,
          },
        },
      )

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await terminal.locator('.xterm').click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

      await window.keyboard.press(`${commandModifier}+N`)

      await expect
        .poll(async () => (await readPersistedWorkspace(window))?.nodes.length ?? 0)
        .toBe(1)
    } finally {
      await electronApp.close()
    }
  })
})
