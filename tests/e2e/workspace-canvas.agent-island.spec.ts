import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  expectOverlayStubReady,
} from './workspace-canvas.terminal-agent-overlay.helpers'

type SparkRecord = { added: number; removed: number }

const SPARK_LOG = '__opencoveIslandSparkLog'

/** Sparks fly for about three seconds; a runner step can take longer, so record them as they come. */
async function recordSparks(window: Page): Promise<void> {
  await window.evaluate(read => {
    const log: SparkRecord = { added: 0, removed: 0 }
    ;(window as unknown as Record<string, SparkRecord>)[read] = log
    const isSparks = (node: Node) =>
      node instanceof HTMLElement && node.dataset.testid === 'agent-island-sparks'
    new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => {
          log.added += isSparks(node) ? 1 : 0
        })
        record.removedNodes.forEach(node => {
          log.removed += isSparks(node) ? 1 : 0
        })
      }
    }).observe(document.body, { childList: true, subtree: true })
  }, SPARK_LOG)
}

async function readSparks(window: Page): Promise<SparkRecord> {
  return await window.evaluate(
    read => (window as unknown as Record<string, SparkRecord>)[read]!,
    SPARK_LOG,
  )
}

/** E2E windows are never focused (`inactive` mode); this is OpenCove coming to the front. */
async function emitWindowFocus(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.emit('focus')
  })
}

async function startWaitingAgent(
  window: Page,
  executionDirectory: string,
  uiTheme: 'dark' | 'light' = 'dark',
): Promise<void> {
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: 'island-terminal',
        kind: 'terminal',
        title: 'Agent terminal',
        position: { x: 180, y: 160 },
        width: 520,
        height: 400,
        executionDirectory,
      },
    ],
    {
      settings: {
        uiTheme,
        standbyBannerEnabled: true,
        standbyBannerShowBranch: false,
        standbyBannerShowPullRequest: false,
        notificationSoundEnabled: false,
      },
    },
  )
  // Seeding reloads the page, so start recording after it.
  await recordSparks(window)
  const terminal = window.locator('[data-id="island-terminal"] .terminal-node')
  await terminal.locator('.xterm-helper-textarea').click()
  await window.keyboard.type('codex')
  await window.keyboard.press('Enter')
  await expectOverlayStubReady(terminal, 'codex')
  await expect(terminal.locator('.terminal-node__status')).toHaveText('Working')
  await window.keyboard.type('<test-overlay-advance>')
  await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
}

test.describe('Agent island', () => {
  test.skip(process.platform === 'win32', 'POSIX terminal shim fixture')

  for (const theme of ['light', 'dark'] as const) {
    test(`labels an unacknowledged completion as finished in ${theme}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const commandDirectory = await createAgentCommandPath()
      const executionDirectory = await mkdtemp(path.join(testWorkspacePath, 'island-finished-'))
      const { electronApp, window } = await launchApp({
        env: {
          PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        },
      })
      try {
        await startWaitingAgent(window, executionDirectory, theme)
        await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', theme)
        const sidebarStatus = window.locator(
          '.workspace-sidebar .workspace-agent-item__status-label',
        )
        await expect(sidebarStatus).toHaveText('Finished')
        const card = window.locator('.agent-island-card__status')
        await expect(card).toHaveText('Finished')
        await testInfo.attach(`finished-attention-${theme}`, {
          body: await window.screenshot(),
          contentType: 'image/png',
        })
        const pill = window.getByTestId('app-header-agent-activity')
        await expect(pill).toHaveAccessibleName('1 agent needs you. Show agents')
        await pill.click()
        const activity = window.getByTestId('app-header-agent-activity-list')
        await expect(activity.getByRole('button', { name: /Finished/ })).toBeVisible()
        await expect(activity).not.toContainText('Needs your answer')
        await testInfo.attach(`finished-activity-${theme}`, {
          body: await window.screenshot(),
          contentType: 'image/png',
        })
      } finally {
        await electronApp.close()
        await rm(commandDirectory, { recursive: true, force: true })
        await rm(executionDirectory, { recursive: true, force: true })
      }
    })
  }

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`a card grows out of the pill${
      reducedMotion === 'reduce' ? ' without sparks under reduced motion' : ' with sparks'
    }, holds while OpenCove is behind, retracts into the pill six seconds after it comes to the front, and the jump answers it`, async () => {
      const commandDirectory = await createAgentCommandPath()
      const executionDirectory = await mkdtemp(path.join(testWorkspacePath, 'island-'))
      const { electronApp, window } = await launchApp({
        env: {
          PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        },
      })
      try {
        await window.emulateMedia({ reducedMotion })
        await startWaitingAgent(window, executionDirectory)

        const pill = window.locator('.agent-activity-pill')
        const stack = window.locator('[data-testid="app-notifications"]')
        const card = stack.locator('.agent-island-card')
        await expect(card).toHaveCount(1)
        await expect(pill).toHaveAttribute('data-tone', 'waiting')

        // Under the pill, right edges flush.
        const pillBox = (await pill.boundingBox())!
        const stackBox = (await stack.boundingBox())!
        expect(stackBox.y).toBeGreaterThanOrEqual(pillBox.y + pillBox.height)
        expect(Math.abs(stackBox.x + stackBox.width - (pillBox.x + pillBox.width))).toBeLessThan(2)

        // The window icon with its project badge, and the waiting light.
        await expect(card.locator('.agent-activity-mark--lg .cove-kind-tile')).toBeVisible()
        await expect(card.locator('.agent-activity-mark__project')).toBeVisible()
        await expect(card.locator('.agent-island-card__light')).toBeVisible()

        if (reducedMotion === 'reduce') {
          expect(await readSparks(window)).toEqual({ added: 0, removed: 0 })
        } else {
          // The canvas mounts for the burst and leaves with its last spark.
          await expect
            .poll(() => readSparks(window), { timeout: 10_000 })
            .toEqual({
              added: 1,
              removed: 1,
            })
        }
        await expect(window.locator('[data-testid="agent-island-sparks"]')).toHaveCount(0)

        // Behind another app every countdown holds, however long.
        await expect(stack).toHaveAttribute('data-paused', 'true')
        await window.waitForTimeout(6_500)
        await expect(card).toHaveCount(1)

        await emitWindowFocus(electronApp)
        await expect(stack).toHaveAttribute('data-paused', 'false')
        await expect(card).toHaveCount(1)
        // The cells go out one by one, not all at once at the end.
        await expect
          .poll(() =>
            card
              .locator('.agent-island-card__countdown')
              .evaluate(cells => window.getComputedStyle(cells, '::after').clipPath),
          )
          .toMatch(/^inset\(0px (?:[1-9]\d?(?:\.\d+)?)% 0px 0px\)$/)
        await expect(stack).toHaveCount(0, { timeout: 10_000 })
        // Retracting only hides the card; the Agent still waits in the pill.
        await expect(pill).toHaveAttribute('data-tone', 'waiting')
        // Its sidebar row waits for you too, rather than standing by.
        const rowStatus = window.locator('.workspace-sidebar .workspace-agent-item__status-label')
        await expect(rowStatus).toHaveText('Finished')

        // Going to it from the list answers it; it only stood by, so the pill goes.
        await pill.click()
        const row = window.locator(
          '[data-testid="app-header-agent-activity-list"] .agent-activity-list__row',
        )
        await expect(row).toHaveCount(1)
        await row.click()
        await expect(pill).toHaveCount(0)
        await expect(stack).toHaveCount(0)
        await expect(rowStatus).toHaveText('Standby')
      } finally {
        await electronApp.close()
        await rm(commandDirectory, { recursive: true, force: true })
        await rm(executionDirectory, { recursive: true, force: true })
      }
    })
  }
})
