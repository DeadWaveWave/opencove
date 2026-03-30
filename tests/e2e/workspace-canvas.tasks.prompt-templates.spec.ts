import { expect, test, type Locator } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, seededWorkspaceId } from './workspace-canvas.helpers'

async function expectMenuAnchoredToTrigger(trigger: Locator, menu: Locator): Promise<void> {
  const triggerBox = await trigger.boundingBox()
  const menuBox = await menu.boundingBox()

  expect(triggerBox).not.toBeNull()
  expect(menuBox).not.toBeNull()

  if (!triggerBox || !menuBox) {
    return
  }

  const triggerRight = triggerBox.x + triggerBox.width
  const triggerBottom = triggerBox.y + triggerBox.height
  const menuRight = menuBox.x + menuBox.width
  const menuBottom = menuBox.y + menuBox.height

  const horizontalAnchorMatches =
    Math.abs(menuBox.x - triggerRight) <= 16 || Math.abs(menuRight - triggerRight) <= 16
  const verticalAnchorMatches =
    Math.abs(menuBox.y - triggerBottom) <= 16 || Math.abs(menuBottom - triggerBottom) <= 16

  expect(horizontalAnchorMatches).toBe(true)
  expect(verticalAnchorMatches).toBe(true)
}

test.describe('Workspace Canvas - Tasks (Prompt Templates)', () => {
  test('supports global + project templates and prefix injection', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

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
      const originalRequirement = 'Implement auth flow'
      await requirement.fill(originalRequirement)

      const creatorTrigger = window.locator(
        '[data-testid="workspace-task-creator-open-prompt-templates"]',
      )
      await creatorTrigger.click()
      const creatorMenu = window.locator('[data-testid="task-creator-prompt-templates-menu"]')
      await expect(creatorMenu).toBeVisible()
      await expectMenuAnchoredToTrigger(creatorTrigger, creatorMenu)

      await window.locator('[data-testid="task-creator-prompt-templates-add-global"]').click()
      const creatorCreateWindow = window.locator(
        '[data-testid="task-creator-prompt-templates-create-window"]',
      )
      await expect(creatorCreateWindow).toBeVisible()

      await window
        .locator('[data-testid="task-creator-prompt-templates-create-name"]')
        .fill('Global A')
      await window
        .locator('[data-testid="task-creator-prompt-templates-create-content"]')
        .fill('GLOBAL-TEMPLATE')
      await window.locator('[data-testid="task-creator-prompt-templates-create-save"]').click()
      await expect(creatorCreateWindow).toBeHidden()

      await creatorTrigger.click()
      await expect(creatorMenu).toBeVisible()
      await expectMenuAnchoredToTrigger(creatorTrigger, creatorMenu)
      await creatorMenu.getByRole('button', { name: 'Global A' }).click()
      await expect(requirement).toHaveValue(`GLOBAL-TEMPLATE\n\n${originalRequirement}`)

      await creatorTrigger.click()
      await expect(creatorMenu).toBeVisible()
      await expectMenuAnchoredToTrigger(creatorTrigger, creatorMenu)
      await window.locator('[data-testid="task-creator-prompt-templates-add-project"]').click()
      await expect(creatorCreateWindow).toBeVisible()

      await window
        .locator('[data-testid="task-creator-prompt-templates-create-name"]')
        .fill('Project A')
      await window
        .locator('[data-testid="task-creator-prompt-templates-create-content"]')
        .fill('PROJECT-TEMPLATE')
      await window.locator('[data-testid="task-creator-prompt-templates-create-save"]').click()
      await expect(creatorCreateWindow).toBeHidden()

      await creatorTrigger.click()
      await expect(creatorMenu).toBeVisible()
      await expectMenuAnchoredToTrigger(creatorTrigger, creatorMenu)
      await creatorMenu.getByRole('button', { name: 'Project A' }).click()
      await expect(requirement).toHaveValue(
        `PROJECT-TEMPLATE\n\nGLOBAL-TEMPLATE\n\n${originalRequirement}`,
      )

      await window.locator('[data-testid="workspace-task-create-submit"]').click()

      const taskNode = window.locator('.task-node').first()
      await expect(taskNode).toBeVisible()

      const inlineRequirementInput = taskNode.locator(
        '[data-testid="task-node-inline-requirement-input"]',
      )
      await expect(inlineRequirementInput).toHaveValue(/^PROJECT-TEMPLATE/)

      const taskNodeTrigger = taskNode.locator('[data-testid="task-node-open-prompt-templates"]')
      await taskNodeTrigger.click()
      const taskNodeMenu = window.locator('[data-testid="task-node-prompt-templates-menu"]')
      await expect(taskNodeMenu).toBeVisible()
      await expectMenuAnchoredToTrigger(taskNodeTrigger, taskNodeMenu)
      await taskNodeMenu.getByRole('button', { name: 'Global A' }).click()
      await expect(inlineRequirementInput).toHaveValue(/^GLOBAL-TEMPLATE/)

      await taskNode.locator('[data-testid="task-node-open-editor"]').click()
      const editor = window.locator('[data-testid="workspace-task-editor"]')
      await expect(editor).toBeVisible()

      const editorRequirement = window.locator('[data-testid="workspace-task-editor-requirement"]')
      await expect(editorRequirement).toHaveValue(/^GLOBAL-TEMPLATE/)

      const editorTrigger = window.locator(
        '[data-testid="workspace-task-editor-open-prompt-templates"]',
      )
      await editorTrigger.click()
      const editorMenu = window.locator('[data-testid="task-editor-prompt-templates-menu"]')
      await expect(editorMenu).toBeVisible()
      await expectMenuAnchoredToTrigger(editorTrigger, editorMenu)
      await editorMenu.getByRole('button', { name: 'Project A' }).click()
      await expect(editorRequirement).toHaveValue(/^PROJECT-TEMPLATE/)

      await window.locator('[data-testid="workspace-task-edit-submit"]').click()
      await expect(editor).toBeHidden()
      await expect(inlineRequirementInput).toHaveValue(/^PROJECT-TEMPLATE/)

      const persisted = await window.evaluate(
        async ({ workspaceId }) => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          if (!raw) {
            return null
          }

          const parsed = JSON.parse(raw) as {
            settings?: {
              taskPromptTemplates?: Array<{ name?: string; content?: string }>
              taskPromptTemplatesByWorkspaceId?: Record<
                string,
                Array<{ name?: string; content?: string }>
              >
            }
            workspaces?: Array<{
              nodes?: Array<{
                kind?: string
                task?: {
                  requirement?: string
                }
              }>
            }>
          }

          return {
            globalTemplates: parsed.settings?.taskPromptTemplates ?? [],
            projectTemplates:
              parsed.settings?.taskPromptTemplatesByWorkspaceId?.[workspaceId] ?? [],
            requirement:
              parsed.workspaces?.[0]?.nodes?.find(node => node.kind === 'task')?.task
                ?.requirement ?? null,
          }
        },
        { workspaceId: seededWorkspaceId },
      )

      expect(persisted).toBeTruthy()
      expect(persisted?.globalTemplates?.some(template => template.name === 'Global A')).toBe(true)
      expect(persisted?.projectTemplates?.some(template => template.name === 'Project A')).toBe(
        true,
      )
      expect(persisted?.requirement ?? '').toMatch(/^PROJECT-TEMPLATE/)
    } finally {
      await electronApp.close()
    }
  })
})
