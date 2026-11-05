import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import {
  MATERIAL_WORKSPACE,
  createMaterialFixture,
  seedMaterialFixture,
} from './workspace-canvas.spatial-pixel.materials.fixture'

test.describe('Sidebar - Space branch', () => {
  test("names a Space's worktree branch on its card, from the same listing as the canvas", async ({
    browserName,
  }) => {
    void browserName
    const fixture = await createMaterialFixture()
    const { electronApp, window } = await launchApp()
    try {
      await seedMaterialFixture(window, fixture)
      const review = window.getByTestId(
        `workspace-space-item-${MATERIAL_WORKSPACE}-pixel-review-space`,
      )
      // The canvas frame and the sidebar card name the same branch.
      await expect(review.locator('.workspace-space-item__meta-branch')).toHaveText('pixel/review')
      await expect(review).toContainText('pixel/review')
      // The build Space works in the project's own checkout: its card names no branch.
      const build = window.getByTestId(
        `workspace-space-item-${MATERIAL_WORKSPACE}-pixel-build-space`,
      )
      await expect(build).toBeVisible()
      await expect(build.locator('.workspace-space-item__meta-branch')).toHaveCount(0)
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })
})
