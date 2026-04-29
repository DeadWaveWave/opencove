import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readSharedState,
  readViewState,
  writeAppState,
} from './helpers'

test.describe('Worker web canvas - Add project', () => {
  test('adds a project via the web UI', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('web-add-project')
    const secondWorkspacePath = await createWorkspaceDir('web-add-project-second')

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        workspaceName: 'web-add-project',
        spaces: [],
      }),
    )

    await openAuthedCanvas(page)

    await page.locator('[data-testid="sidebar-add-project"]').click()
    await expect(page.locator('[data-testid="workspace-project-create-window"]')).toBeVisible()

    await page
      .locator('[data-testid="workspace-project-create-default-local-root"]')
      .fill(secondWorkspacePath)
    await page.locator('[data-testid="workspace-project-create-confirm"]').click()

    await expect(page.locator('[data-testid="workspace-project-create-window"]')).toHaveCount(0)

    await expect
      .poll(async () => {
        const shared = await readSharedState(page.request)
        return shared.state?.workspaces.map(workspace => workspace.path) ?? []
      })
      .toContain(secondWorkspacePath)

    await expect
      .poll(async () => {
        const [shared, viewState] = await Promise.all([
          readSharedState(page.request),
          readViewState(page),
        ])
        const activeWorkspaceId =
          viewState && typeof viewState === 'object' && 'activeWorkspaceId' in viewState
            ? (viewState as { activeWorkspaceId?: unknown }).activeWorkspaceId
            : null

        if (typeof activeWorkspaceId !== 'string') {
          return null
        }

        const activeWorkspace =
          shared.state?.workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null

        return activeWorkspace?.path ?? null
      })
      .toBe(secondWorkspacePath)
  })
})
