import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  expectOverlayStubReady,
} from './workspace-canvas.terminal-agent-overlay.helpers'

test.describe('Terminal Agent completion banner', () => {
  test.skip(process.platform === 'win32', 'POSIX terminal shim fixture')
  for (const provider of ['codex', 'claude-code'] as const) {
    test(`${provider} uses the shared completion card after a terminal-launched turn`, async () => {
      const commandDirectory = await createAgentCommandPath()
      const executionDirectory = await mkdtemp(path.join(testWorkspacePath, 'banner-terminal-'))
      const { electronApp, window } = await launchApp({
        env: {
          PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        },
      })
      try {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'banner-terminal',
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
              standbyBannerEnabled: true,
              standbyBannerShowBranch: false,
              standbyBannerShowPullRequest: false,
            },
          },
        )
        const terminal = window.locator('[data-id="banner-terminal"] .terminal-node')
        const cards = window.locator('.app-notification')
        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.type(provider === 'codex' ? 'codex' : 'claude')
        await window.keyboard.press('Enter')
        await expectOverlayStubReady(terminal, provider)
        await expect(terminal.locator('.terminal-node__status')).toHaveText('Working')
        await expect(cards).toHaveCount(0)
        await window.keyboard.type('<test-overlay-advance>')
        await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
        await expect(cards).toHaveCount(1)
        await expect(cards.first()).toContainText('Standby')
        await window.screenshot({
          path: test.info().outputPath(`${provider}-terminal-complete.png`),
        })
        const initialViewport = await readCanvasViewport(window)
        await window.locator('.react-flow__controls-zoomout').click()
        await expect.poll(() => readCanvasViewport(window)).not.toEqual(initialViewport)
        const beforeNavigation = await readCanvasViewport(window)
        await cards.first().click()
        await expect(cards).toHaveCount(0)
        await expect.poll(() => readCanvasViewport(window)).not.toEqual(beforeNavigation)
      } finally {
        await electronApp.close()
        await rm(commandDirectory, { recursive: true, force: true })
        await rm(executionDirectory, { recursive: true, force: true })
      }
    })
  }
})
