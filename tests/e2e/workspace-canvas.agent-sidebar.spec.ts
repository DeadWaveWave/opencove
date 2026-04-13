import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Agent Sidebar', () => {
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
          position: { x: 720, y: 460 },
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
            resumeSessionIdVerified: true,
            executionDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
      ])

      const agentItem = window.locator('.workspace-sidebar .workspace-agent-item').first()
      await expect(agentItem).toBeVisible()
      await expect(agentItem.locator('.workspace-agent-item__task')).toHaveCount(0)

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      const zoomBefore = (await readCanvasViewport(window)).zoom
      expect(zoomBefore).toBeGreaterThan(1.01)

      await agentItem.click()

      const agentNodes = window
        .locator('.terminal-node')
        .filter({ has: window.locator('.terminal-node__title', { hasText: 'codex' }) })
      const agentNode = agentNodes.first()

      await expect(agentNode).toBeVisible()

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
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
      await expect(agentNode.locator('.terminal-node__status')).toHaveText('Standby')

      const agentHeader = agentNode.locator('.terminal-node__header')
      await agentHeader.click()

      const fitViewButton = window.locator('.react-flow__controls-fitview')
      await expect(fitViewButton).toBeVisible()
      await fitViewButton.click()

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return Math.max(delta.dx, delta.dy)
        })
        .toBeGreaterThan(180)

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      await pane.click({
        position: {
          x: Math.floor(paneBox.width * 0.6),
          y: Math.floor(paneBox.height * 0.5),
        },
      })

      await expect
        .poll(async () => {
          const delta = await readCenterDelta()
          return Math.max(delta.dx, delta.dy)
        })
        .toBeGreaterThan(180)

      await agentNode.locator('.terminal-node__close').click()
      await expect(agentNodes).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('shows sidebar agent status and linked task title', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'task-status-doing',
          title: 'Implement OAuth refresh flow',
          position: { x: 80, y: 120 },
          width: 460,
          height: 280,
          kind: 'task',
          task: {
            requirement: 'Handle OAuth token refresh and retry once',
            status: 'doing',
            linkedAgentNodeId: 'agent-status-doing',
            lastRunAt: '2026-02-10T08:40:00.000Z',
            autoGeneratedTitle: false,
          },
        },
        {
          id: 'task-status-request',
          title: 'Clarify API contract with PM',
          position: { x: 80, y: 460 },
          width: 460,
          height: 280,
          kind: 'task',
          task: {
            requirement: 'List unknown fields and ask for confirmation',
            status: 'doing',
            linkedAgentNodeId: 'agent-status-request',
            lastRunAt: '2026-02-10T09:00:00.000Z',
            autoGeneratedTitle: false,
          },
        },
        {
          id: 'task-status-done',
          title: 'Finalize migration checklist',
          position: { x: 80, y: 800 },
          width: 460,
          height: 280,
          kind: 'task',
          task: {
            requirement: 'Complete migration checklist and report',
            status: 'ai_done',
            linkedAgentNodeId: 'agent-status-done',
            lastRunAt: '2026-02-10T09:20:00.000Z',
            autoGeneratedTitle: false,
          },
        },
        {
          id: 'agent-status-doing',
          title: 'codex · gpt-5.2-codex',
          position: { x: 620, y: 120 },
          width: 520,
          height: 320,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-02-10T08:45:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          agent: {
            provider: 'codex',
            prompt: 'Implement OAuth refresh flow',
            model: 'gpt-5.2-codex',
            effectiveModel: 'gpt-5.2-codex',
            launchMode: 'new',
            resumeSessionId: '019c3e32-52ff-7b00-94ac-e6c5a56b4aa5',
            resumeSessionIdVerified: true,
            executionDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
        {
          id: 'agent-status-request',
          title: 'claude · claude-sonnet-4-5',
          position: { x: 620, y: 460 },
          width: 520,
          height: 320,
          kind: 'agent',
          status: 'exited',
          startedAt: '2026-02-10T09:00:00.000Z',
          endedAt: '2026-02-10T09:03:00.000Z',
          exitCode: 0,
          lastError: null,
          agent: {
            provider: 'claude-code',
            prompt: 'Clarify API contract with PM',
            model: 'claude-sonnet-4-5',
            effectiveModel: 'claude-sonnet-4-5',
            launchMode: 'new',
            resumeSessionId: 'claude-session-done',
            resumeSessionIdVerified: true,
            executionDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
        {
          id: 'agent-status-done',
          title: 'claude · claude-opus-4-6',
          position: { x: 620, y: 800 },
          width: 520,
          height: 320,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-02-10T09:20:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          agent: {
            provider: 'claude-code',
            prompt: 'Finalize migration checklist',
            model: 'claude-opus-4-6',
            effectiveModel: 'claude-opus-4-6',
            launchMode: 'new',
            resumeSessionId: 'claude-session-done',
            resumeSessionIdVerified: true,
            executionDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
      ])

      const doingItem = window.locator(
        '[data-testid="workspace-agent-item-workspace-seeded-agent-status-doing"]',
      )
      const requestItem = window.locator(
        '[data-testid="workspace-agent-item-workspace-seeded-agent-status-request"]',
      )
      const doneItem = window.locator(
        '[data-testid="workspace-agent-item-workspace-seeded-agent-status-done"]',
      )

      const requestNode = window
        .locator('.terminal-node')
        .filter({
          has: window.locator('.terminal-node__title', {
            hasText: 'claude · claude-sonnet-4-5',
          }),
        })
        .first()

      await requestItem.click()
      await expect(requestNode).toBeVisible()

      await expect(doingItem.locator('.workspace-agent-item__status--agent')).toHaveText(
        'Standby',
        { timeout: 30_000 },
      )
      await expect(requestItem.locator('.workspace-agent-item__status--agent')).toHaveText(
        'Standby',
      )
      await expect(doneItem.locator('.workspace-agent-item__status--agent')).toHaveText('Standby', {
        timeout: 30_000,
      })

      await expect(doingItem.locator('.workspace-agent-item__task-text')).toHaveText(
        'Implement OAuth refresh flow',
      )
      await expect(requestItem.locator('.workspace-agent-item__task-text')).toHaveText(
        'Clarify API contract with PM',
      )
      await expect(doneItem.locator('.workspace-agent-item__task-text')).toHaveText(
        'Finalize migration checklist',
      )
    } finally {
      await electronApp.close()
    }
  })
})
