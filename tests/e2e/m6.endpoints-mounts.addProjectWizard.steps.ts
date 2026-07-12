import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { selectCoveOption } from './workspace-canvas.helpers'

async function renameActiveProject(window: Page, projectName: string): Promise<void> {
  const activeProject = window.locator('.workspace-item.workspace-item--active')
  await expect(activeProject).toBeVisible()
  if ((await activeProject.textContent())?.includes(projectName)) {
    return
  }

  await activeProject.click({ button: 'right', force: true })
  await window.locator('[data-testid="workspace-project-context-menu-rename"]').click()
  const renameInput = window.locator('.workspace-project-context-menu__rename input')
  await renameInput.fill(projectName)
  await window.locator('[data-testid="workspace-project-context-menu-rename-save"]').click()
  await expect(window.locator('.workspace-item.workspace-item--active')).toContainText(projectName)
}

export async function createLocalOnlyProjectViaWizard({
  window,
  projectName,
  localRootPath,
}: {
  window: Page
  projectName: string
  localRootPath: string
}): Promise<void> {
  await window.locator('[data-testid="workspace-sidebar-add-project"]').click({ noWaitAfter: true })
  const projectWindow = window.locator('[data-testid="workspace-project-create-window"]')
  if ((await projectWindow.count()) > 0) {
    await expect(projectWindow).toBeVisible()
    await window
      .locator('[data-testid="workspace-project-create-default-local-root"]')
      .fill(localRootPath)
    await window.locator('[data-testid="workspace-project-create-confirm"]').click()
    await expect(projectWindow).toHaveCount(0)
  }
  await renameActiveProject(window, projectName)
}

export async function createRemoteOnlyProjectViaWizard({
  window,
  projectName,
  remoteEndpointId,
  remoteRootPath,
}: {
  window: Page
  projectName: string
  remoteEndpointId: string
  remoteRootPath: string
}): Promise<void> {
  await window.locator('[data-testid="workspace-sidebar-add-project"]').click({ noWaitAfter: true })
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toBeVisible()
  await window
    .locator('[data-testid="workspace-project-create-default-location-remote"]')
    .click({ noWaitAfter: true })
  await selectCoveOption(
    window,
    'workspace-project-create-default-remote-endpoint',
    remoteEndpointId,
  )

  await window.locator('[data-testid="workspace-project-create-default-remote-browse"]').click()
  await expect(window.locator('[data-testid="remote-directory-picker-window"]')).toBeVisible()

  const folderName = path.basename(remoteRootPath)
  const pathInput = window.locator('[data-testid="remote-directory-picker-path"]')

  const entry = window
    .locator('[data-testid^="remote-directory-picker-entry-"]')
    .filter({ hasText: folderName })
    .first()
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(pathInput).toHaveValue(new RegExp(`${folderName.replaceAll('\\', '\\\\')}$`))
  await window.locator('[data-testid="remote-directory-picker-select"]').click()
  await expect(window.locator('[data-testid="remote-directory-picker-window"]')).toHaveCount(0)

  await window.locator('[data-testid="workspace-project-create-confirm"]').click()
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toHaveCount(0)
  await renameActiveProject(window, projectName)
}

export async function createMultiMountProjectViaWizard({
  window,
  projectName,
  localRootPath,
  remoteEndpointId,
  remoteRootPath,
  remoteMountName,
}: {
  window: Page
  projectName: string
  localRootPath: string
  remoteEndpointId: string
  remoteRootPath: string
  remoteMountName: string
}): Promise<void> {
  await window.locator('[data-testid="workspace-sidebar-add-project"]').click({ noWaitAfter: true })
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toBeVisible()
  await window
    .locator('[data-testid="workspace-project-create-default-local-root"]')
    .fill(localRootPath)

  await window.locator('[data-testid="workspace-project-create-confirm"]').click()
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toHaveCount(0)
  await renameActiveProject(window, projectName)

  const activeProject = window.locator('.workspace-item.workspace-item--active')
  await activeProject.click({ button: 'right', force: true })
  await window.locator('[data-testid^="workspace-project-manage-mounts-"]').click()
  await expect(
    window.locator('[data-testid="workspace-project-mount-manager-window"]'),
  ).toBeVisible()
  await selectCoveOption(window, 'workspace-project-mount-remote-endpoint', remoteEndpointId)
  await window.locator('[data-testid="workspace-project-mount-remote-root"]').fill(remoteRootPath)
  await window.locator('[data-testid="workspace-project-mount-remote-name"]').fill(remoteMountName)
  await window.locator('[data-testid="workspace-project-mount-add-remote"]').click()
  await expect(window.locator('[data-testid^="workspace-project-mount-remove-"]')).toHaveCount(2)
  await window.locator('[data-testid="workspace-project-mount-close"]').click()
}
