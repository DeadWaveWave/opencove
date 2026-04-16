import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'path'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { resolveE2ETmpDir } from './workspace-canvas.testUtils'

test.describe('Workspace Canvas - Space Explorer', () => {
  test('shows an error when the space directory is outside approved roots', async ({
    browserName,
  }, testInfo) => {
    const fixtureDir = path.join(
      resolveE2ETmpDir(),
      'opencove-e2e-unapproved-space-explorer',
      randomUUID(),
    )

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(path.join(fixtureDir, 'hello.md'), 'hello', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-unapproved-anchor',
            title: 'Anchor note',
            position: { x: 600, y: 460 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Keep this space alive',
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-unapproved',
              name: 'Unapproved Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-unapproved-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 620,
                height: 420,
              },
            },
          ],
          activeSpaceId: 'space-unapproved',
        },
      )

      const filesPill = window.locator('[data-testid="workspace-space-files-space-unapproved"]')
      await expect(filesPill).toBeVisible()
      await filesPill.click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      const errorState = explorer.locator('.workspace-space-explorer__state--error')
      await expect(errorState).toBeVisible()
      await expect(errorState).toContainText('approved workspaces')

      await testInfo.attach(`space-explorer-unapproved-${browserName}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })

  test('keeps the canvas clipped and does not show the root branch badge when Explorer opens', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-root-anchor',
            title: 'Root anchor',
            position: { x: 380, y: 320 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Keep root space visible',
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-root-explorer',
              name: 'Root Explorer',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-root-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 920,
                height: 520,
              },
            },
          ],
          activeSpaceId: 'space-root-explorer',
        },
      )

      const branchBadge = window.locator(
        '[data-testid="workspace-space-worktree-branch-space-root-explorer"]',
      )
      await expect(branchBadge).toHaveCount(0)

      const filesPill = window.locator('[data-testid="workspace-space-files-space-root-explorer"]')
      await expect(filesPill).toBeVisible()
      await filesPill.click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      const layoutOverflow = await window.evaluate(() => {
        const main = document.querySelector('.workspace-main') as HTMLElement | null
        if (!main) {
          return null
        }

        return {
          hasHorizontalOverflow: main.scrollWidth > main.clientWidth + 1,
          hasVerticalOverflow: main.scrollHeight > main.clientHeight + 1,
        }
      })

      expect(layoutOverflow).toEqual({
        hasHorizontalOverflow: false,
        hasVerticalOverflow: false,
      })

      await window.waitForTimeout(1_500)
      await expect(branchBadge).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('resizes Explorer width and auto-closes when its space leaves the viewport', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer',
      randomUUID(),
    )

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(path.join(fixtureDir, 'hello.md'), 'hello', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-explorer-anchor',
            title: 'Anchor note',
            position: { x: 380, y: 320 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Keep this space alive',
            },
          },
          {
            id: 'space-away-anchor',
            title: 'Away note',
            position: { x: 2480, y: 1560 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Move viewport away',
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-explorer',
              name: 'Explorer Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-explorer-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 960,
                height: 520,
              },
            },
            {
              id: 'space-away',
              name: 'Away Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-away-anchor'],
              rect: {
                x: 2440,
                y: 1520,
                width: 680,
                height: 440,
              },
            },
          ],
          activeSpaceId: 'space-explorer',
        },
      )

      const filesPill = window.locator('[data-testid="workspace-space-files-space-explorer"]')
      await expect(filesPill).toBeVisible()
      await filesPill.click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()
      const viewportHeight = await window.evaluate(() => window.innerHeight)
      const explorerBox = await explorer.boundingBox()
      if (!explorerBox) {
        throw new Error('Explorer bounding box unavailable')
      }
      expect(Math.ceil(explorerBox.y + explorerBox.height)).toBeLessThanOrEqual(viewportHeight)

      const readExplorerWidth = async (): Promise<number> =>
        Math.round((await explorer.boundingBox())?.width ?? 0)
      await expect.poll(readExplorerWidth).toBeGreaterThan(250)
      await window.waitForTimeout(150)

      const boxBefore = await explorer.boundingBox()
      if (!boxBefore) {
        throw new Error('Explorer bounding box unavailable')
      }

      const resizeHandle = window.locator('.workspace-space-explorer__resize-handle')
      await expect(resizeHandle).toBeVisible()
      const handleBox = await resizeHandle.boundingBox()
      if (!handleBox) {
        throw new Error('Resize handle bounding box unavailable')
      }

      const startPoint = {
        x: handleBox.x + handleBox.width / 2,
        y: handleBox.y + handleBox.height / 2,
      }

      await dragMouse(window, {
        start: startPoint,
        end: { x: startPoint.x + 160, y: startPoint.y },
        steps: 20,
        settleAfterPressMs: 64,
        settleBeforeReleaseMs: 96,
        settleAfterReleaseMs: 64,
      })

      await expect
        .poll(readExplorerWidth)
        .toBeGreaterThanOrEqual(Math.min(Math.round(boxBefore.width) + 20, 360))

      await window.locator('[data-testid="workspace-space-switch-space-away"]').click()
      await expect(explorer).toBeHidden()
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
