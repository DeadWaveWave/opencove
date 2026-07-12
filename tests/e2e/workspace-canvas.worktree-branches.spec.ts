import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { resolveE2ETmpDir } from './workspace-canvas.testUtils'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
}

async function createTempRepo(): Promise<string> {
  const repoDir = await mkdtemp(path.join(resolveE2ETmpDir(), 'opencove-worktree-branches-e2e-'))

  await runGit(['init'], repoDir)
  await runGit(['config', 'user.email', 'test@example.com'], repoDir)
  await runGit(['config', 'user.name', 'OpenCove Test'], repoDir)
  await runGit(['config', 'core.autocrlf', 'false'], repoDir)
  await runGit(['config', 'core.safecrlf', 'false'], repoDir)
  await writeFile(path.join(repoDir, 'README.md'), '# temp\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)
  await runGit(['branch', 'release/1.1.2'], repoDir)

  return await realpath(repoDir)
}

test.describe('Workspace Canvas - Worktree Branches', () => {
  test('loads and selects git branches above the Space Worktree window', async ({
    browserName: _browserName,
  }, testInfo) => {
    let repoPath = ''

    try {
      repoPath = await createTempRepo()

      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        env: {
          OPENCOVE_TEST_WORKSPACE: repoPath,
        },
      })

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: 'workspace-worktree-branches',
          workspaces: [
            {
              id: 'workspace-worktree-branches',
              name: path.basename(repoPath),
              path: repoPath,
              nodes: [
                {
                  id: 'note-worktree-branches',
                  title: 'Worktree Branches',
                  position: { x: 220, y: 180 },
                  width: 320,
                  height: 220,
                  kind: 'note',
                  task: { text: 'seed' },
                },
              ],
              spaces: [
                {
                  id: 'space-worktree-root',
                  name: 'Root Space',
                  directoryPath: repoPath,
                  nodeIds: ['note-worktree-branches'],
                  rect: { x: 180, y: 140, width: 620, height: 420 },
                },
              ],
              activeSpaceId: 'space-worktree-root',
            },
          ],
        })

        await expect(window.locator('.note-node').first()).toBeVisible()

        await window.locator('[data-testid="workspace-space-switch-space-worktree-root"]').click()
        await window.locator('[data-testid="workspace-space-menu-space-worktree-root"]').click()
        await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
        const createAction = window.locator('[data-testid="workspace-space-action-create"]')
        const actionRect = await createAction.boundingBox()
        await mkdir('artifacts/popup-ui-motion', { recursive: true })
        await window.evaluate(() => {
          const samples: Array<{
            timeMs: number
            opacity: string
            transform: string
            left: number
            top: number
          }> = []
          ;(
            window as typeof window & {
              __opencovePopoverMotionSamples?: typeof samples
            }
          ).__opencovePopoverMotionSamples = samples
          const startedAt = performance.now()
          const observer = new MutationObserver(() => {
            const popover = document.querySelector('[data-testid="space-worktree-popover"]')
            if (!(popover instanceof HTMLElement)) {
              return
            }

            observer.disconnect()
            const sample = (): void => {
              const style = window.getComputedStyle(popover)
              const rect = popover.getBoundingClientRect()
              samples.push({
                timeMs: performance.now() - startedAt,
                opacity: style.opacity,
                transform: style.transform,
                left: rect.left,
                top: rect.top,
              })
              if (performance.now() - startedAt < 220) {
                requestAnimationFrame(sample)
              }
            }
            requestAnimationFrame(sample)
          })
          observer.observe(document.body, { childList: true, subtree: true })
        })
        await createAction.click()

        const worktreeWindow = window.locator('[data-testid="space-worktree-window"]')
        await expect(worktreeWindow).toBeVisible()
        const popover = window.locator('[data-testid="space-worktree-popover"]')
        await window.waitForTimeout(220)
        await window.screenshot({ path: 'artifacts/popup-ui-worktree.dark.png' })

        const popoverRect = await popover.boundingBox()
        const motionStyle = await popover.evaluate(element => {
          const style = window.getComputedStyle(element)
          return {
            animationName: style.animationName,
            animationDuration: style.animationDuration,
          }
        })
        expect(actionRect).not.toBeNull()
        expect(popoverRect).not.toBeNull()
        expect(Math.abs((popoverRect?.x ?? 0) - (actionRect?.x ?? 0))).toBeLessThanOrEqual(2)
        expect(Math.abs((popoverRect?.y ?? 0) - (actionRect?.y ?? 0))).toBeLessThanOrEqual(2)
        expect(motionStyle.animationName).toContain('anchored-operation-popover-in')
        expect(motionStyle.animationDuration).toBe('0.14s')
        const motionSamples = await window.evaluate(() => {
          return (
            (
              window as typeof window & {
                __opencovePopoverMotionSamples?: Array<{
                  timeMs: number
                  opacity: string
                  transform: string
                  left: number
                  top: number
                }>
              }
            ).__opencovePopoverMotionSamples ?? []
          )
        })
        expect(motionSamples.length).toBeGreaterThan(2)
        expect(Number.parseFloat(motionSamples[0]?.opacity ?? '1')).toBeLessThan(1)
        expect(Number.parseFloat(motionSamples.at(-1)?.opacity ?? '0')).toBe(1)
        expect(
          Math.max(...motionSamples.map(sample => sample.left)) -
            Math.min(...motionSamples.map(sample => sample.left)),
        ).toBeLessThanOrEqual(0.5)
        expect(
          Math.max(...motionSamples.map(sample => sample.top)) -
            Math.min(...motionSamples.map(sample => sample.top)),
        ).toBeLessThanOrEqual(3.1)

        await popover.evaluate(element => {
          if (!(element instanceof HTMLElement)) {
            return
          }
          element.style.animation = 'none'
          void element.offsetWidth
          element.style.animation =
            'anchored-operation-popover-in 600ms cubic-bezier(0.2, 0.8, 0.2, 1)'
        })
        await window.screenshot({ path: 'artifacts/popup-ui-motion/frame_000_000ms.png' })
        await window.waitForTimeout(180)
        await window.screenshot({ path: 'artifacts/popup-ui-motion/frame_001_180ms.png' })
        await window.waitForTimeout(480)
        await window.screenshot({ path: 'artifacts/popup-ui-motion/frame_002_660ms.png' })
        await writeFile(
          'artifacts/popup-ui-motion/measurements.json',
          JSON.stringify(
            {
              theme: 'dark',
              anchor: actionRect,
              finalPopover: popoverRect,
              animation: motionStyle,
              productionMotionSamples: motionSamples,
              captureFixture: { replayDurationMs: 600 },
              thresholds: { anchorDeltaPx: 2, durationMs: 200 },
            },
            null,
            2,
          ),
          'utf8',
        )

        await worktreeWindow.locator('[data-testid="space-worktree-start-point-trigger"]').click()
        const startPointMenu = window.locator('[data-testid="space-worktree-start-point-menu"]')
        await expect(startPointMenu).toBeVisible()
        await expect
          .poll(async () => {
            const [menuZIndex, popoverZIndex] = await Promise.all([
              startPointMenu.evaluate(element => Number(window.getComputedStyle(element).zIndex)),
              popover.evaluate(element => Number(window.getComputedStyle(element).zIndex)),
            ])
            return menuZIndex - popoverZIndex
          })
          .toBeGreaterThan(0)
        await testInfo.attach('space-worktree-branch-menu', {
          body: await window.screenshot(),
          contentType: 'image/png',
        })
        await startPointMenu.locator('[data-cove-select-option-value="release/1.1.2"]').click()
        await expect(
          worktreeWindow.locator('[data-testid="space-worktree-start-point"]'),
        ).toHaveValue('release/1.1.2')

        await worktreeWindow.locator('[data-testid="space-worktree-mode-existing"]').click()

        const existingBranch = worktreeWindow.locator(
          '[data-testid="space-worktree-existing-branch"]',
        )
        await expect(existingBranch).toHaveValue(/\S+/)

        await worktreeWindow
          .locator('[data-testid="space-worktree-existing-branch-trigger"]')
          .click()
        const branchMenu = window.locator('[data-testid="space-worktree-existing-branch-menu"]')
        await expect(branchMenu).toBeVisible()
        const layerZIndexes = await window.evaluate(() => {
          const popoverElement = document.querySelector('[data-testid="space-worktree-popover"]')
          const menu = document.querySelector('[data-testid="space-worktree-existing-branch-menu"]')
          return {
            popover: Number.parseInt(
              popoverElement ? window.getComputedStyle(popoverElement).zIndex : '0',
              10,
            ),
            menu: Number.parseInt(menu ? window.getComputedStyle(menu).zIndex : '0', 10),
          }
        })
        expect(layerZIndexes.menu).toBeGreaterThan(layerZIndexes.popover)
        await window.screenshot({ path: 'artifacts/popup-ui-worktree-branch-list.dark.png' })
        await branchMenu.locator('[role="option"]').first().click()
        await expect(worktreeWindow).toBeVisible()
        await expect(popover).toBeVisible()

        await expect(worktreeWindow.locator('.workspace-space-worktree__error')).toHaveCount(0)
      } finally {
        await electronApp.close()
      }
    } finally {
      if (repoPath) {
        await removePathWithRetry(repoPath)
      }
    }
  })
})
