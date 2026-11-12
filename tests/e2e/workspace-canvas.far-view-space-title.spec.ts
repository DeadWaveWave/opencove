import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'
import { lodOf, setZoom } from './workspace-canvas.far-view.helpers'

const LEFT = 'far-title-left'
const RIGHT = 'far-title-right'

/** How far the Space's centre sits from the canvas centre, in screen px. */
async function offCentre(window: Page, spaceId: string): Promise<number> {
  return await window.getByTestId(`workspace-space-region-${spaceId}`).evaluate(region => {
    const canvas = region.closest('.workspace-canvas')!.getBoundingClientRect()
    const rect = region.getBoundingClientRect()
    return Math.hypot(
      rect.left + rect.width / 2 - (canvas.left + canvas.width / 2),
      rect.top + rect.height / 2 - (canvas.top + canvas.height / 2),
    )
  })
}

test.describe('Workspace Canvas - Space title by level of detail', () => {
  test('far away the title focuses its Space; up close it renames it', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'far-title-left-note',
            title: 'left note',
            position: { x: 140, y: 160 },
            width: 320,
            height: 220,
            kind: 'note',
            task: { text: 'Left' },
          },
          {
            id: 'far-title-right-note',
            title: 'right note',
            position: { x: 2140, y: 1160 },
            width: 320,
            height: 220,
            kind: 'note',
            task: { text: 'Right' },
          },
        ],
        {
          spaces: [
            {
              id: LEFT,
              name: 'Left Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['far-title-left-note'],
              rect: { x: 100, y: 100, width: 640, height: 420 },
            },
            {
              id: RIGHT,
              name: 'Right Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['far-title-right-note'],
              rect: { x: 2100, y: 1100, width: 640, height: 420 },
            },
          ],
        },
      )

      const title = window.getByTestId(`workspace-space-label-${RIGHT}`)
      const renameField = window.getByTestId(`workspace-space-label-input-${RIGHT}`)

      await setZoom(window, 0.12)
      await expect.poll(() => lodOf(window)).toBe('far')
      const before = await offCentre(window, RIGHT)
      expect(before).toBeGreaterThan(60)

      await title.click()
      await expect(renameField).toHaveCount(0)
      await expect.poll(() => offCentre(window, RIGHT)).toBeLessThan(24)
      await expect.poll(() => lodOf(window)).toBe('near')

      await title.click()
      await expect(renameField).toBeVisible()
      await expect(renameField).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })
})
