import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { selectCoveOption } from './workspace-canvas.helpers'

export async function createLocalOnlyProjectViaWizard({
  window,
  projectName,
  localRootPath,
}: {
  window: Page
  projectName: string
  localRootPath: string
}): Promise<void> {
  await window.locator('[data-testid="sidebar-add-project"]').click({ noWaitAfter: true })
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toBeVisible()
  await window.locator('[data-testid="workspace-project-create-name"]').fill(projectName)

  await window
    .locator('[data-testid="workspace-project-create-default-local-root"]')
    .fill(localRootPath)

  await window.locator('[data-testid="workspace-project-create-confirm"]').click()
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toHaveCount(0)
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
  await window.locator('[data-testid="sidebar-add-project"]').click({ noWaitAfter: true })
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toBeVisible()
  await window.locator('[data-testid="workspace-project-create-name"]').fill(projectName)

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
  await window.locator('[data-testid="sidebar-add-project"]').click({ noWaitAfter: true })
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toBeVisible()
  await window.locator('[data-testid="workspace-project-create-name"]').fill(projectName)

  await window
    .locator('[data-testid="workspace-project-create-default-local-root"]')
    .fill(localRootPath)

  await window.locator('[data-testid="workspace-project-create-advanced-toggle"]').click()
  await selectCoveOption(window, 'workspace-project-create-extra-remote-endpoint', remoteEndpointId)
  await window
    .locator('[data-testid="workspace-project-create-extra-remote-root"]')
    .fill(remoteRootPath)
  await window
    .locator('[data-testid="workspace-project-create-extra-remote-name"]')
    .fill(remoteMountName)
  await window.locator('[data-testid="workspace-project-create-extra-remote-add"]').click()

  await window.locator('[data-testid="workspace-project-create-confirm"]').click()
  await expect(window.locator('[data-testid="workspace-project-create-window"]')).toHaveCount(0)
}
