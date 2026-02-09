import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import path from 'path'

const electronAppPath = path.resolve(__dirname, '../../')
const testWorkspacePath = path.resolve(__dirname, '../../')
const storageKey = 'cove:m0:workspace-state'
const seededWorkspaceId = 'workspace-seeded'

interface SeedAgentData {
  provider: 'claude-code' | 'codex'
  prompt: string
  model: string | null
  effectiveModel: string | null
  launchMode: 'new' | 'resume'
  resumeSessionId: string | null
  executionDirectory: string
  directoryMode: 'workspace' | 'custom'
  customDirectory: string | null
  shouldCreateDirectory: boolean
}

interface SeedNode {
  id: string
  title: string
  position: {
    x: number
    y: number
  }
  width: number
  height: number
  kind?: 'terminal' | 'agent'
  status?: 'running' | 'exited' | 'failed' | 'stopped' | 'restoring' | null
  startedAt?: string | null
  endedAt?: string | null
  exitCode?: number | null
  lastError?: string | null
  scrollback?: string | null
  agent?: SeedAgentData | null
}

interface SeedWorkspace {
  id: string
  name: string
  path: string
  nodes: SeedNode[]
}

async function launchApp(): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const electronApp = await electron.launch({
    args: [electronAppPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      COVE_TEST_WORKSPACE: testWorkspacePath,
    },
  })

  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return { electronApp, window }
}

async function seedWorkspaceState(
  window: Page,
  payload: {
    activeWorkspaceId: string
    workspaces: SeedWorkspace[]
    settings?: unknown
  },
): Promise<void> {
  const seededState = {
    activeWorkspaceId: payload.activeWorkspaceId,
    workspaces: payload.workspaces,
    ...(payload.settings ? { settings: payload.settings } : {}),
  }

  const trySeed = async (attempt: number): Promise<boolean> => {
    if (attempt >= 3) {
      return false
    }

    await window.evaluate(
      ({ key, state }) => {
        window.localStorage.setItem(key, JSON.stringify(state))
      },
      {
        key: storageKey,
        state: seededState,
      },
    )

    await window.reload({ waitUntil: 'domcontentloaded' })

    const seededReady = await window.evaluate(
      ({ key, expectedWorkspaces }) => {
        const raw = window.localStorage.getItem(key)
        if (!raw) {
          return false
        }

        try {
          const parsed = JSON.parse(raw) as {
            workspaces?: Array<{
              id?: string
              nodes?: Array<{
                id?: string
              }>
            }>
          }

          if (!Array.isArray(parsed.workspaces)) {
            return false
          }

          const workspaceById = new Map(
            parsed.workspaces
              .filter(workspace => typeof workspace.id === 'string')
              .map(workspace => [workspace.id as string, workspace]),
          )

          return expectedWorkspaces.every(expectedWorkspace => {
            const loadedWorkspace = workspaceById.get(expectedWorkspace.id)
            if (!loadedWorkspace || !Array.isArray(loadedWorkspace.nodes)) {
              return false
            }

            const loadedNodeIds = loadedWorkspace.nodes
              .map(node => (typeof node.id === 'string' ? node.id : ''))
              .filter(id => id.length > 0)

            if (loadedNodeIds.length !== expectedWorkspace.nodeIds.length) {
              return false
            }

            return expectedWorkspace.nodeIds.every(nodeId => loadedNodeIds.includes(nodeId))
          })
        } catch {
          return false
        }
      },
      {
        key: storageKey,
        expectedWorkspaces: payload.workspaces.map(workspace => ({
          id: workspace.id,
          nodeIds: workspace.nodes.map(node => node.id),
        })),
      },
    )

    const workspaceCount = await window.locator('.workspace-item').count()
    if (seededReady && workspaceCount >= payload.workspaces.length) {
      return true
    }

    return await trySeed(attempt + 1)
  }

  const success = await trySeed(0)
  if (!success) {
    throw new Error('Failed to deterministically seed workspace state')
  }
}

async function clearAndSeedWorkspace(
  window: Page,
  nodes: SeedNode[],
  options?: {
    settings?: unknown
  },
): Promise<void> {
  await seedWorkspaceState(window, {
    activeWorkspaceId: seededWorkspaceId,
    workspaces: [
      {
        id: seededWorkspaceId,
        name: path.basename(testWorkspacePath),
        path: testWorkspacePath,
        nodes,
      },
    ],
    settings: options?.settings,
  })
}

test.describe('Workspace Canvas Interactions', () => {
  test('keeps terminal visible after drag, resize, and node interactions', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-1',
          title: 'terminal-1',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
        {
          id: 'node-2',
          title: 'terminal-2',
          position: { x: 760, y: 200 },
          width: 460,
          height: 300,
        },
      ])

      await expect(window.locator('.workspace-canvas')).toBeVisible()
      await expect(window.locator('.workspace-item__meta').first()).toContainText('2 terminals')

      const terminals = window.locator('.terminal-node')
      await expect(terminals).toHaveCount(2)

      const firstTerminal = terminals.first()
      await expect(firstTerminal).toBeVisible()
      await expect(firstTerminal.locator('.xterm')).toBeVisible()

      const header = firstTerminal.locator('.terminal-node__header')
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await header.dragTo(pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 520, y: 420 },
      })

      await expect(firstTerminal).toBeVisible()
      await expect(firstTerminal.locator('.xterm')).toBeVisible()

      const rightResizer = firstTerminal.locator('[data-testid="terminal-resizer-right"]')
      const rightResizerBox = await rightResizer.boundingBox()
      if (!rightResizerBox) {
        throw new Error('terminal right resizer bounding box unavailable')
      }

      const rightStartX = rightResizerBox.x + rightResizerBox.width / 2
      const rightStartY = rightResizerBox.y + rightResizerBox.height / 2

      await window.mouse.move(rightStartX, rightStartY)
      await window.mouse.down()
      await window.mouse.move(rightStartX + 120, rightStartY + 80)
      await window.mouse.up()

      const widthResizedNode = await window.evaluate(key => {
        const raw = window.localStorage.getItem(key)
        if (!raw) {
          return null
        }

        const state = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id: string
              width: number
              height: number
            }>
          }>
        }

        return state.workspaces?.[0]?.nodes?.find(node => node.id === 'node-1') ?? null
      }, storageKey)

      expect(widthResizedNode).toBeTruthy()
      expect(widthResizedNode?.width ?? 0).toBeGreaterThan(460)
      expect(widthResizedNode?.height).toBe(300)

      const bottomResizer = firstTerminal.locator('[data-testid="terminal-resizer-bottom"]')
      const bottomResizerBox = await bottomResizer.boundingBox()
      if (!bottomResizerBox) {
        throw new Error('terminal bottom resizer bounding box unavailable')
      }

      const bottomStartX = bottomResizerBox.x + bottomResizerBox.width / 2
      const bottomStartY = bottomResizerBox.y + bottomResizerBox.height / 2

      await window.mouse.move(bottomStartX, bottomStartY)
      await window.mouse.down()
      await window.mouse.move(bottomStartX + 120, bottomStartY + 80)
      await window.mouse.up()

      const heightResizedNode = await window.evaluate(key => {
        const raw = window.localStorage.getItem(key)
        if (!raw) {
          return null
        }

        const state = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id: string
              width: number
              height: number
            }>
          }>
        }

        return state.workspaces?.[0]?.nodes?.find(node => node.id === 'node-1') ?? null
      }, storageKey)

      expect(heightResizedNode).toBeTruthy()
      expect(heightResizedNode?.width).toBe(widthResizedNode?.width)
      expect(heightResizedNode?.height ?? 0).toBeGreaterThan(300)
      await expect(firstTerminal.locator('.xterm')).toBeVisible()

      await terminals.nth(1).locator('.terminal-node__header').click()

      await expect(firstTerminal).toBeVisible()
      await expect(firstTerminal.locator('.xterm')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('keeps agent tui visible while dragging window', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-agent-drag',
          title: 'codex · gpt-5.2-codex',
          position: { x: 120, y: 120 },
          width: 520,
          height: 320,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-02-09T00:00:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          agent: {
            provider: 'codex',
            prompt: 'Keep tui stable during drag',
            model: 'gpt-5.2-codex',
            effectiveModel: 'gpt-5.2-codex',
            launchMode: 'resume',
            resumeSessionId: '019c3e32-52ff-7b00-94ac-e6c5a56b4aa4',
            executionDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
      ])

      const agentNode = window.locator('.terminal-node').first()
      await expect(agentNode).toBeVisible()
      await expect(agentNode.locator('.xterm')).toBeVisible()
      await expect(agentNode).toContainText('[cove-test-agent]')

      const header = agentNode.locator('.terminal-node__header')
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await header.dragTo(pane, {
        sourcePosition: { x: 120, y: 16 },
        targetPosition: { x: 680, y: 420 },
      })

      await expect(agentNode).toBeVisible()
      await expect(agentNode.locator('.xterm')).toBeVisible()
      await expect(agentNode).toContainText('[cove-test-agent]')
    } finally {
      await electronApp.close()
    }
  })

  test('wheel over terminal does not zoom canvas', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-wheel',
          title: 'terminal-wheel',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const viewport = window.locator('.react-flow__viewport')
      const beforeTransform = await viewport.getAttribute('style')

      await terminal.hover()
      await window.mouse.wheel(0, -1200)

      const afterTransform = await viewport.getAttribute('style')
      expect(afterTransform).toBe(beforeTransform)
      await expect(terminal.locator('.xterm')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('normalizes canvas zoom and centers clicked terminal', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-zoom-1',
          title: 'terminal-zoom-1',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
        {
          id: 'node-zoom-2',
          title: 'terminal-zoom-2',
          position: { x: 820, y: 520 },
          width: 460,
          height: 300,
        },
      ])

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()

      await zoomInButton.click()
      await zoomInButton.click()

      const readZoom = async (): Promise<number> => {
        return await window.evaluate(() => {
          const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
          if (!viewport) {
            return 1
          }

          const style = window.getComputedStyle(viewport)
          const matrix = style.transform.match(/matrix\(([^)]+)\)/)
          if (!matrix) {
            return 1
          }

          const values = matrix[1].split(',').map(item => Number(item.trim()))
          const zoom = values[0]
          return Number.isFinite(zoom) ? zoom : 1
        })
      }

      const zoomBefore = await readZoom()
      expect(zoomBefore).toBeGreaterThan(1.01)

      const firstTerminal = window.locator('.terminal-node').filter({ hasText: 'terminal-zoom-1' })
      await expect(firstTerminal).toBeVisible()
      await firstTerminal.locator('.xterm').click()

      await expect
        .poll(async () => {
          return await readZoom()
        })
        .toBeCloseTo(1, 2)

      const secondTerminal = window.locator('.terminal-node').filter({ hasText: 'terminal-zoom-2' })
      await expect(secondTerminal).toBeVisible()
      await secondTerminal.locator('.xterm').click()

      const readCenterDelta = async (): Promise<{ dx: number; dy: number }> => {
        const canvasBox = await window.locator('.workspace-canvas .react-flow').boundingBox()
        const terminalBox = await secondTerminal.boundingBox()

        if (!canvasBox || !terminalBox) {
          return {
            dx: Number.POSITIVE_INFINITY,
            dy: Number.POSITIVE_INFINITY,
          }
        }

        const canvasCenterX = canvasBox.x + canvasBox.width / 2
        const canvasCenterY = canvasBox.y + canvasBox.height / 2
        const terminalCenterX = terminalBox.x + terminalBox.width / 2
        const terminalCenterY = terminalBox.y + terminalBox.height / 2

        return {
          dx: Math.abs(canvasCenterX - terminalCenterX),
          dy: Math.abs(canvasCenterY - terminalCenterY),
        }
      }

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return delta.dx
        })
        .toBeLessThan(140)

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return delta.dy
        })
        .toBeLessThan(140)
    } finally {
      await electronApp.close()
    }
  })

  test('preserves terminal history after workspace switch', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-a',
        workspaces: [
          {
            id: 'workspace-a',
            name: 'workspace-a',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-a',
                title: 'terminal-a',
                position: { x: 120, y: 120 },
                width: 460,
                height: 300,
              },
            ],
          },
          {
            id: 'workspace-b',
            name: 'workspace-b',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'node-b',
                title: 'terminal-b',
                position: { x: 160, y: 160 },
                width: 460,
                height: 300,
              },
            ],
          },
        ],
      })

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const token = `COVE_PERSIST_${Date.now()}`
      await terminal.locator('.xterm').click()
      await window.keyboard.type(`echo ${token}`)
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(token)

      await window.locator('.workspace-item').nth(1).click()
      await expect(window.locator('.workspace-item').nth(1)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)

      await window.locator('.workspace-item').nth(0).click()
      await expect(window.locator('.workspace-item').nth(0)).toHaveClass(/workspace-item--active/)
      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(window.locator('.terminal-node').first()).toContainText(token)
    } finally {
      await electronApp.close()
    }
  })

  test('preserves terminal history after app reload', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-reload',
          title: 'terminal-reload',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const token = `COVE_RELOAD_${Date.now()}`
      await terminal.locator('.xterm').click()
      await window.keyboard.type(`echo ${token}`)
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(token)

      await expect
        .poll(
          async () => {
            return await window.evaluate(
              ({ key, nodeId, expected }) => {
                const raw = window.localStorage.getItem(key)
                if (!raw) {
                  return false
                }

                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    id?: string
                    nodes?: Array<{
                      id?: string
                      scrollback?: string | null
                    }>
                  }>
                }

                const workspace = parsed.workspaces?.find(item => item.id === 'workspace-seeded')
                const node = workspace?.nodes?.find(item => item.id === nodeId)
                return typeof node?.scrollback === 'string' && node.scrollback.includes(expected)
              },
              {
                key: storageKey,
                nodeId: 'node-reload',
                expected: token,
              },
            )
          },
          { timeout: 10_000 },
        )
        .toBe(true)

      await window.reload({ waitUntil: 'domcontentloaded' })

      const reloadedTerminal = window.locator('.terminal-node').first()
      await expect(reloadedTerminal).toBeVisible()
      await expect(reloadedTerminal.locator('.xterm')).toBeVisible()
      await expect(reloadedTerminal).toContainText(token)
    } finally {
      await electronApp.close()
    }
  })

  test('wheel over terminal scrolls terminal viewport', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-scroll',
          title: 'terminal-scroll',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await terminal.locator('.xterm').click()
      await window.keyboard.type(
        'i=1; while [ $i -le 260 ]; do echo COVE_SCROLL_$i; i=$((i+1)); done',
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('COVE_SCROLL_260')

      const viewport = terminal.locator('.xterm-viewport')
      await expect(viewport).toBeVisible()

      const visibleRows = terminal.locator('.xterm-rows')
      const beforeRows = await visibleRows.innerText()

      await terminal.hover()
      await window.mouse.wheel(0, -1200)
      await window.waitForTimeout(120)

      const afterRows = await visibleRows.innerText()
      expect(afterRows).not.toBe(beforeRows)
    } finally {
      await electronApp.close()
    }
  })

  test('runs agent from launcher v2 and creates node', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [], {
        settings: {
          defaultProvider: 'codex',
          customModelEnabledByProvider: {
            'claude-code': false,
            codex: true,
          },
          customModelByProvider: {
            'claude-code': '',
            codex: 'gpt-5.2-codex',
          },
          customModelOptionsByProvider: {
            'claude-code': [],
            codex: ['gpt-5.2-codex'],
          },
        },
      })

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 320, y: 220 },
      })

      const runButton = window.locator('[data-testid="workspace-context-run-default-agent"]')
      await expect(runButton).toBeVisible()
      await runButton.click()

      const launcher = window.locator('[data-testid="workspace-agent-launcher"]')
      await expect(launcher).toBeVisible()

      await window.locator('[data-testid="workspace-agent-launch-provider"]').selectOption('codex')
      await window.locator('[data-testid="workspace-agent-launch-model"]').fill('gpt-5.2-codex')

      const promptInput = window.locator('[data-testid="workspace-agent-launch-prompt"]')
      await promptInput.fill('Generate implementation plan for API error handling')

      const submitButton = window.locator('[data-testid="workspace-agent-launch-submit"]')
      await submitButton.click()

      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(window.locator('.terminal-node__title').first()).toContainText('gpt-5.2-codex')
      await expect(window.locator('.terminal-node').first().locator('.xterm')).toBeVisible()
      await expect(window.locator('.terminal-node').first()).toContainText(
        '[cove-test-agent] codex new',
      )
      await expect(window.locator('.workspace-agent-item')).toHaveCount(1)
    } finally {
      await electronApp.close()
    }
  })

  test('creates task node with auto title and runs linked agent', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [], {
        settings: {
          defaultProvider: 'codex',
          customModelEnabledByProvider: {
            'claude-code': false,
            codex: true,
          },
          customModelByProvider: {
            'claude-code': '',
            codex: 'gpt-5.2-codex',
          },
          customModelOptionsByProvider: {
            'claude-code': [],
            codex: ['gpt-5.2-codex'],
          },
          taskTitleProvider: 'codex',
          taskTitleModel: 'gpt-5.2-codex',
        },
      })

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 320, y: 220 },
      })

      await window.locator('[data-testid="workspace-context-new-task"]').click()

      const taskCreator = window.locator('[data-testid="workspace-task-creator"]')
      await expect(taskCreator).toBeVisible()

      const requirement = window.locator('[data-testid="workspace-task-requirement"]')
      await requirement.fill('Implement login retry with exponential backoff and jitter')

      await window.locator('[data-testid="workspace-task-create-submit"]').click()

      const taskNode = window.locator('.task-node').first()
      await expect(taskNode).toBeVisible()
      await expect(taskNode.locator('.task-node__title')).toContainText('Auto:')

      await taskNode.locator('[data-testid="task-node-run-agent"]').click()

      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(window.locator('.workspace-agent-item')).toHaveCount(1)

      const taskStatus = taskNode.locator('[data-testid="task-node-status-select"]')
      await expect(taskStatus).toHaveValue('doing')

      const persisted = await window.evaluate(key => {
        const raw = window.localStorage.getItem(key)
        if (!raw) {
          return null
        }

        const parsed = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              kind?: string
              title?: string
              task?: {
                requirement?: string
                autoGeneratedTitle?: boolean
              }
            }>
          }>
        }

        return parsed.workspaces?.[0]?.nodes?.find(node => node.kind === 'task') ?? null
      }, storageKey)

      expect(persisted).toBeTruthy()
      expect(persisted?.task?.requirement).toContain('exponential backoff')
      expect(persisted?.task?.autoGeneratedTitle).toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('supports agent controls and sidebar navigation', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'terminal-nav-node',
          title: 'terminal-1',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
          kind: 'terminal',
        },
        {
          id: 'agent-nav-node',
          title: 'codex · gpt-5.2-codex',
          position: { x: 1400, y: 980 },
          width: 520,
          height: 320,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-02-08T15:00:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          agent: {
            provider: 'codex',
            prompt: 'Implement resilient retry logic',
            model: 'gpt-5.2-codex',
            effectiveModel: 'gpt-5.2-codex',
            launchMode: 'new',
            resumeSessionId: '019c3e32-52ff-7b00-94ac-e6c5a56b4aa4',
            executionDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
      ])

      const agentItem = window.locator('.workspace-agent-item').first()
      await expect(agentItem).toBeVisible()

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      const readZoom = async (): Promise<number> => {
        return await window.evaluate(() => {
          const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
          if (!viewport) {
            return 1
          }

          const style = window.getComputedStyle(viewport)
          const matrix = style.transform.match(/matrix\(([^)]+)\)/)
          if (!matrix) {
            return 1
          }

          const values = matrix[1].split(',').map(item => Number(item.trim()))
          const zoom = values[0]
          return Number.isFinite(zoom) ? zoom : 1
        })
      }

      const zoomBefore = await readZoom()
      expect(zoomBefore).toBeGreaterThan(1.01)

      await agentItem.click()

      const agentNode = window
        .locator('.terminal-node')
        .filter({ has: window.locator('.terminal-node__title', { hasText: 'codex' }) })
        .first()

      await expect(agentNode).toBeVisible()

      await expect
        .poll(async () => {
          return await readZoom()
        })
        .toBeCloseTo(1, 2)

      const readCenterDelta = async (): Promise<{ dx: number; dy: number }> => {
        const canvasBox = await window.locator('.workspace-canvas .react-flow').boundingBox()
        const terminalBox = await agentNode.boundingBox()

        if (!canvasBox || !terminalBox) {
          return {
            dx: Number.POSITIVE_INFINITY,
            dy: Number.POSITIVE_INFINITY,
          }
        }

        const canvasCenterX = canvasBox.x + canvasBox.width / 2
        const canvasCenterY = canvasBox.y + canvasBox.height / 2
        const terminalCenterX = terminalBox.x + terminalBox.width / 2
        const terminalCenterY = terminalBox.y + terminalBox.height / 2

        return {
          dx: Math.abs(canvasCenterX - terminalCenterX),
          dy: Math.abs(canvasCenterY - terminalCenterY),
        }
      }

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return delta.dx
        })
        .toBeLessThan(140)

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return delta.dy
        })
        .toBeLessThan(140)
      await expect(agentNode.locator('.terminal-node__status')).toHaveText('Running')

      await agentNode.locator('.terminal-node__action', { hasText: 'Stop' }).click()
      await expect(agentNode.locator('.terminal-node__status')).toHaveText('Stopped')

      await agentNode.locator('.terminal-node__action', { hasText: 'Rerun' }).click()
      await expect(agentNode.locator('.terminal-node__status')).toHaveText(/Restoring|Running/)

      await expect(agentNode.locator('.terminal-node__status')).toHaveText('Running')

      await agentNode.locator('.terminal-node__action', { hasText: 'Resume' }).click()
      await expect(agentNode.locator('.terminal-node__status')).toHaveText(/Restoring|Running/)
      await expect(agentNode.locator('.terminal-node__status')).toHaveText('Running')
    } finally {
      await electronApp.close()
    }
  })
})
