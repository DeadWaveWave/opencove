import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

test.describe('Worker web canvas agent resume', () => {
  test('resumes task-linked agent sessions via remote resume mode', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('task-agent-resume')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
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
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 320, y: 220 } })
    await page.locator('[data-testid="workspace-context-new-task"]').click()

    const taskCreator = page.locator('[data-testid="workspace-task-creator"]')
    await expect(taskCreator).toBeVisible()

    await page
      .locator('[data-testid="workspace-task-requirement"]')
      .fill('Verify remote agent resume flow')

    await page.locator('[data-testid="workspace-task-create-submit"]').click()

    const taskNode = page.locator('.task-node').first()
    await expect(taskNode).toBeVisible()
    await taskNode.locator('[data-testid="task-node-run-agent"]').click()

    const agentTerminal = page.locator('.terminal-node').first()
    await expect(agentTerminal).toBeVisible()
    await expect(agentTerminal.locator('.xterm')).toBeVisible()
    await expect(agentTerminal).toContainText('[opencove-test-agent] codex new')

    await expect
      .poll(
        async () => {
          const shared = await readSharedState(page.request)
          const nodes = shared.state?.workspaces?.[0]?.nodes ?? []
          const taskStateNode = nodes.find(node => node.kind === 'task')
          const taskRecord =
            taskStateNode && typeof taskStateNode === 'object' && 'task' in taskStateNode
              ? (taskStateNode as Record<string, unknown>)
              : null
          const taskData =
            taskRecord &&
            taskRecord.task &&
            typeof taskRecord.task === 'object' &&
            !Array.isArray(taskRecord.task)
              ? (taskRecord.task as Record<string, unknown>)
              : null

          const linkedAgentNodeId =
            typeof taskData?.linkedAgentNodeId === 'string' ? taskData.linkedAgentNodeId.trim() : ''

          if (linkedAgentNodeId.length === 0) {
            return null
          }

          const agentNode = nodes.find(node => {
            if (node.kind !== 'agent') {
              return false
            }

            const nodeId = typeof node.id === 'string' ? node.id.trim() : ''
            return nodeId === linkedAgentNodeId
          })

          const agentRecord =
            agentNode && typeof agentNode === 'object' && 'agent' in agentNode
              ? (agentNode as Record<string, unknown>)
              : null
          const agentData =
            agentRecord &&
            agentRecord.agent &&
            typeof agentRecord.agent === 'object' &&
            !Array.isArray(agentRecord.agent)
              ? (agentRecord.agent as Record<string, unknown>)
              : null

          const resumeSessionId =
            typeof agentData?.resumeSessionId === 'string' ? agentData.resumeSessionId.trim() : ''

          return resumeSessionId.length > 0 ? resumeSessionId : null
        },
        { timeout: 30_000 },
      )
      .toBeTruthy()

    const fitViewButton = page.locator('.react-flow__controls-fitview')
    await expect(fitViewButton).toBeVisible()
    await fitViewButton.click()
    await expect(agentTerminal.locator('.terminal-node__close')).toBeInViewport()
    await agentTerminal.locator('.terminal-node__close').click()
    await expect(page.locator('.terminal-node')).toHaveCount(0)

    const sessionRecord = taskNode
      .locator(
        '[data-testid="task-node-agent-sessions"] [data-testid^="task-node-agent-session-record-"]',
      )
      .first()
    await expect(sessionRecord).toBeVisible()
    await sessionRecord.click({ button: 'right' })

    const resumeMenuButton = page.locator('[data-testid^="task-node-agent-session-menu-resume-"]')
    await expect(resumeMenuButton).toBeVisible()
    await resumeMenuButton.click()

    const resumeConfirmButton = page.locator(
      '[data-testid^="task-node-agent-session-resume-confirm-resume-"]',
    )
    await expect(resumeConfirmButton).toBeVisible()
    await resumeConfirmButton.click()

    const resumedTerminal = page.locator('.terminal-node').first()
    await expect(resumedTerminal).toBeVisible()
    await expect(resumedTerminal.locator('.xterm')).toBeVisible()
    await expect(resumedTerminal).toContainText('[opencove-test-agent] codex resume')
  })
})
