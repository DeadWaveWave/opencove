import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { openPaneContextMenuInSpace } from './workspace-canvas.arrange.shared'

const seededSpaceId = 'space-role-seeded'

interface RoleFormInput {
  name: string
  description: string
  promptTemplate: string
  inputHint: string
  outputFormat: string
}

async function openProjectRoleMenu(window: Page, pane: Locator, spaceId = seededSpaceId) {
  await openPaneContextMenuInSpace(window, pane, spaceId)
  await window.locator('[data-testid="workspace-context-run-role"]').click()
  await expect(window.locator('[data-testid="workspace-context-run-role-menu"]')).toBeVisible()
}

async function fillRoleCreator(window: Page, input: RoleFormInput): Promise<void> {
  await window.locator('[data-testid="workspace-role-name-input"]').fill(input.name)
  await window.locator('[data-testid="workspace-role-description-input"]').fill(input.description)
  await window.locator('[data-testid="workspace-role-prompt-input"]').fill(input.promptTemplate)
  await window.locator('[data-testid="workspace-role-input-hint-input"]').fill(input.inputHint)
  await window
    .locator('[data-testid="workspace-role-output-format-input"]')
    .fill(input.outputFormat)
}

async function readRolePersistence(window: Page): Promise<{
  roleId: string | null
  roleName: string | null
  roleDescription: string | null
  promptTemplate: string | null
  inputHint: string | null
  outputFormat: string | null
  targetMountId: string | null
}> {
  return await window.evaluate(
    async ({ workspaceId, spaceId }) => {
      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      if (!raw) {
        return {
          roleId: null,
          roleName: null,
          roleDescription: null,
          promptTemplate: null,
          inputHint: null,
          outputFormat: null,
          targetMountId: null,
        }
      }

      const parsed = JSON.parse(raw) as {
        settings?: {
          projectRolesByWorkspaceId?: Record<
            string,
            Array<{
              id?: string
              name?: string
              description?: string
              promptTemplate?: string
              inputHint?: string
              outputFormat?: string
            }>
          >
        }
        workspaces?: Array<{
          id?: string
          spaces?: Array<{
            id?: string
            targetMountId?: string | null
          }>
        }>
      }

      const workspace = parsed.workspaces?.find(candidate => candidate.id === workspaceId)
      const role = parsed.settings?.projectRolesByWorkspaceId?.[workspaceId]?.[0]
      const space = workspace?.spaces?.find(candidate => candidate.id === spaceId)

      return {
        roleId: typeof role?.id === 'string' ? role.id : null,
        roleName: typeof role?.name === 'string' ? role.name : null,
        roleDescription: typeof role?.description === 'string' ? role.description : null,
        promptTemplate: typeof role?.promptTemplate === 'string' ? role.promptTemplate : null,
        inputHint: typeof role?.inputHint === 'string' ? role.inputHint : null,
        outputFormat: typeof role?.outputFormat === 'string' ? role.outputFormat : null,
        targetMountId: typeof space?.targetMountId === 'string' ? space.targetMountId : null,
      }
    },
    { workspaceId: seededWorkspaceId, spaceId: seededSpaceId },
  )
}

async function replaceWorkspaceMount(window: Page): Promise<{
  previousMountId: string
  nextMountId: string
}> {
  return await window.evaluate(
    async ({ workspaceId, rootPath }) => {
      const mountResult = await window.opencoveApi.controlSurface.invoke<{
        mounts: Array<{ mountId: string; rootPath: string }>
      }>({
        kind: 'query',
        id: 'mount.list',
        payload: { projectId: workspaceId },
      })

      const previousMount = mountResult.mounts[0]
      if (!previousMount) {
        throw new Error('Expected an existing workspace mount.')
      }

      await Promise.all(
        mountResult.mounts.map(mount =>
          window.opencoveApi.controlSurface
            .invoke({
              kind: 'command',
              id: 'mount.remove',
              payload: { mountId: mount.mountId },
            })
            .catch(() => undefined),
        ),
      )

      const created = await window.opencoveApi.controlSurface.invoke<{
        mount: { mountId: string }
      }>({
        kind: 'command',
        id: 'mount.create',
        payload: {
          projectId: workspaceId,
          endpointId: 'local',
          rootPath,
          name: 'Role Space Rebound',
        },
      })

      return {
        previousMountId: previousMount.mountId,
        nextMountId: created.mount.mountId,
      }
    },
    { workspaceId: seededWorkspaceId, rootPath: testWorkspacePath },
  )
}

async function createRoleFromMenu(
  window: Page,
  pane: Locator,
  input: RoleFormInput,
): Promise<string> {
  await openProjectRoleMenu(window, pane)
  await window.locator('[data-testid="workspace-context-new-role"]').click()

  const creator = window.locator('[data-testid="workspace-role-creator"]')
  await expect(creator).toBeVisible()
  await fillRoleCreator(window, input)
  await window.locator('[data-testid="workspace-role-create"]').click()
  await expect(creator).toHaveCount(0)

  await expect(window.locator('.role-node')).toHaveCount(1)

  await expect
    .poll(async () => {
      const persisted = await readRolePersistence(window)
      return persisted.roleId
    })
    .toBeTruthy()

  const persisted = await readRolePersistence(window)
  if (!persisted.roleId) {
    throw new Error('Failed to persist project role definition')
  }

  return persisted.roleId
}

async function seedRoleWorkspace(window: Page): Promise<void> {
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
    spaces: [
      {
        id: seededSpaceId,
        name: 'Role Space',
        directoryPath: testWorkspacePath,
        labelColor: null,
        nodeIds: [],
        rect: {
          x: 120,
          y: 80,
          width: 980,
          height: 620,
        },
      },
    ],
    activeSpaceId: seededSpaceId,
  })
}

test.describe('Workspace Canvas - Roles', () => {
  test('creates, edits, runs, and persists role metadata with stale mount repair', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const firstLaunch = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
      })

      try {
        const { window } = firstLaunch

        await seedRoleWorkspace(window)

        const pane = window.locator('.workspace-canvas .react-flow__pane')
        await expect(pane).toBeVisible()

        const roleId = await createRoleFromMenu(window, pane, {
          name: 'Product Manager',
          description: 'Draft requirements and align tradeoffs.',
          promptTemplate: 'You are the product manager. Produce a concise PRD.',
          inputHint: 'Feature brief',
          outputFormat: 'PRD',
        })

        await openProjectRoleMenu(window, pane)
        await window.locator(`[data-testid="workspace-context-run-role-more-${roleId}"]`).click()
        await window.locator(`[data-testid="workspace-context-edit-role-${roleId}"]`).click()

        const creator = window.locator('[data-testid="workspace-role-creator"]')
        await expect(creator).toBeVisible()
        await window
          .locator('[data-testid="workspace-role-description-input"]')
          .fill('Draft requirements, risks, and rollout notes.')
        await window
          .locator('[data-testid="workspace-role-prompt-input"]')
          .fill('You are the product manager. Produce a rollout-ready PRD with risks.')
        await window.locator('[data-testid="workspace-role-create"]').click()
        await expect(creator).toHaveCount(0)

        const roleNode = window.locator('.role-node').first()
        await expect(roleNode).toBeVisible()
        await expect(roleNode.locator('[data-testid="role-node-title"]')).toHaveText(
          'Product Manager',
        )
        await expect(roleNode.locator('.role-node__description')).toHaveText(
          'Draft requirements, risks, and rollout notes.',
        )
        await expect(roleNode.locator('[data-testid="role-node-input"]')).toHaveAttribute(
          'placeholder',
          'Feature brief',
        )

        const reboundMount = await replaceWorkspaceMount(window)
        const beforeRunPersistence = await readRolePersistence(window)
        expect(beforeRunPersistence.inputHint).toBe('Feature brief')
        expect(beforeRunPersistence.outputFormat).toBe('PRD')
        expect(beforeRunPersistence.targetMountId).toBe(reboundMount.previousMountId)
        expect(reboundMount.nextMountId).not.toBe(reboundMount.previousMountId)

        await window.locator('.role-node').first().locator('[data-testid="role-node-run"]').click()

        await expect(window.locator('.terminal-node')).toHaveCount(1)
        await expect(window.locator('.workspace-sidebar .workspace-agent-item')).toHaveCount(1)
        await expect(window.locator('.workspace-role-agent-edge')).toHaveCount(1)

        await expect
          .poll(async () => {
            const persisted = await readRolePersistence(window)
            return {
              roleDescription: persisted.roleDescription,
              promptTemplate: persisted.promptTemplate,
              inputHint: persisted.inputHint,
              outputFormat: persisted.outputFormat,
              targetMountId: persisted.targetMountId,
            }
          })
          .toEqual({
            roleDescription: 'Draft requirements, risks, and rollout notes.',
            promptTemplate: 'You are the product manager. Produce a rollout-ready PRD with risks.',
            inputHint: 'Feature brief',
            outputFormat: 'PRD',
            targetMountId: reboundMount.nextMountId,
          })

        // This test's restart assertion covers role metadata, not active-Agent recovery. End the
        // launched runtime explicitly so its worker session and launch artifacts settle before the
        // cold restart reads the shared user-data directory.
        await window.locator('.terminal-node').first().locator('.terminal-node__close').click()
        await expect(window.locator('.terminal-node')).toHaveCount(0)
      } finally {
        await firstLaunch.electronApp.close()
      }

      const secondLaunch = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
      })

      try {
        const restartedRoleNode = secondLaunch.window.locator('.role-node').first()
        await expect(restartedRoleNode).toBeVisible()
        await expect(restartedRoleNode.locator('[data-testid="role-node-title"]')).toHaveText(
          'Product Manager',
        )
        await expect(restartedRoleNode.locator('.role-node__description')).toHaveText(
          'Draft requirements, risks, and rollout notes.',
        )
        await expect(restartedRoleNode.locator('[data-testid="role-node-input"]')).toHaveAttribute(
          'placeholder',
          'Feature brief',
        )

        const restartedPersistence = await readRolePersistence(secondLaunch.window)
        expect(restartedPersistence.inputHint).toBe('Feature brief')
        expect(restartedPersistence.outputFormat).toBe('PRD')
        expect(restartedPersistence.targetMountId).toBeTruthy()
      } finally {
        await secondLaunch.electronApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })

  test('prevents an existing role node from running after its project definition is deleted', async () => {
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

    try {
      await seedRoleWorkspace(window)

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const roleId = await createRoleFromMenu(window, pane, {
        name: 'Reviewer',
        description: 'Audit changes for regressions.',
        promptTemplate: 'Review the change and list concrete risks.',
        inputHint: 'Diff or PR context',
        outputFormat: 'Review findings',
      })

      const roleNode = window.locator('.role-node').first()
      await expect(roleNode).toBeVisible()

      await openProjectRoleMenu(window, pane)
      await window.locator(`[data-testid="workspace-context-run-role-more-${roleId}"]`).click()
      await window.locator(`[data-testid="workspace-context-delete-role-${roleId}"]`).click()
      await window.locator(`[data-testid="workspace-context-delete-role-${roleId}"]`).click()

      await expect
        .poll(async () => {
          const persisted = await readRolePersistence(window)
          return persisted.roleId
        })
        .toBeNull()

      await roleNode.locator('[data-testid="role-node-run"]').click()

      await expect(roleNode.locator('.role-node__error')).toHaveText(
        'This role definition is missing.',
      )
      await expect(window.locator('.terminal-node')).toHaveCount(0)
      await expect(window.locator('.workspace-role-agent-edge')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
