import { expect, type Page } from '@playwright/test'

export async function confirmSpaceTargetMountIfPrompted(
  window: Page,
  options?: {
    targetMountId?: string
  },
): Promise<boolean> {
  const pickerWindow = window.locator('[data-testid="workspace-space-target-mount-window"]')
  const pickerConfirm = window.locator('[data-testid="workspace-space-target-mount-confirm"]')

  const pickerVisible = await pickerWindow
    .waitFor({ state: 'visible', timeout: 1_000 })
    .then(() => true)
    .catch(() => false)

  if (!pickerVisible) {
    return false
  }

  if (options?.targetMountId) {
    await window
      .locator(`[data-testid="workspace-space-target-mount-${options.targetMountId}"]`)
      .check()
  }

  await expect(pickerConfirm).toBeEnabled()
  await pickerConfirm.click()
  await expect(pickerWindow).toHaveCount(0)
  return true
}
