import { expect, type Page } from '@playwright/test'

export async function selectSpaceLabelColorWithRetry(
  window: Page,
  payload: {
    spaceId: string
    color: string
    attempts?: number
    verification?: 'switcher' | 'region'
  },
): Promise<void> {
  const spaceMenuButton = window.locator(`[data-testid="workspace-space-menu-${payload.spaceId}"]`)
  const actionMenu = window.locator('[data-testid="workspace-space-action-menu"]')
  const labelColorMenu = window.locator('[data-testid="workspace-space-action-label-color-menu"]')
  const colorButton = window.locator(
    `[data-testid="workspace-space-action-label-color-${payload.color}"]`,
  )
  const spaceSwitcher =
    payload.verification === 'region'
      ? window.locator('.workspace-space-region', {
          has: window.getByTestId(`workspace-space-label-${payload.spaceId}`),
        })
      : window.locator(`[data-testid="workspace-space-switch-${payload.spaceId}"]`)
  const maxAttempts = payload.attempts ?? 3

  const attemptSelection = async (attempt: number): Promise<void> => {
    await expect(spaceMenuButton).toBeVisible()
    await spaceMenuButton.scrollIntoViewIfNeeded().catch(() => undefined)

    try {
      await spaceMenuButton.click({ timeout: 6_000 })
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error
      }

      await spaceMenuButton.click({ timeout: 6_000, force: true })
    }
    await expect(actionMenu).toBeVisible()
    await expect(labelColorMenu).toBeVisible()
    const [actionMenuBox, labelColorMenuBox] = await Promise.all([
      actionMenu.boundingBox(),
      labelColorMenu.boundingBox(),
    ])
    if (!actionMenuBox || !labelColorMenuBox) {
      throw new Error('Space action menu or label color row bounding box not available')
    }
    expect(actionMenuBox.width).toBeLessThanOrEqual(222)
    const colorButtonBox = await colorButton.boundingBox()
    if (!colorButtonBox) {
      throw new Error(`Label color button "${payload.color}" bounding box not available`)
    }
    expect(colorButtonBox.width).toBeCloseTo(colorButtonBox.height, 0)
    expect(colorButtonBox.width).toBeLessThanOrEqual(20.5)
    expect(colorButtonBox.width).toBeGreaterThanOrEqual(19.5)
    expect(
      Math.abs(
        colorButtonBox.y +
          colorButtonBox.height / 2 -
          (labelColorMenuBox.y + labelColorMenuBox.height / 2),
      ),
    ).toBeLessThanOrEqual(1.5)

    await colorButton.click().catch(() => undefined)

    try {
      await expect
        .poll(
          async () => {
            return await spaceSwitcher.getAttribute('data-cove-label-color')
          },
          { timeout: 3_000 },
        )
        .toBe(payload.color === 'none' ? null : payload.color)
    } catch {
      if (attempt >= maxAttempts) {
        throw new Error(`Failed to select label color "${payload.color}" for ${payload.spaceId}`)
      }

      // Retry the menu path from a clean state. Offscreen E2E can occasionally collapse the
      // submenu or lose the option click before the color state commits.
      return await attemptSelection(attempt + 1)
    }
  }

  await attemptSelection(1)
}
