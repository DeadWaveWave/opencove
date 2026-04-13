import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, selectCoveOption } from './workspace-canvas.helpers'

function wantsRealOpenCode(): boolean {
  const flag = process.env['OPENCOVE_TEST_USE_REAL_AGENTS']
  if (!flag) {
    return false
  }

  return flag === '1' || flag.toLowerCase() === 'true'
}

test.describe('Workspace Canvas - OpenCode Embedded Theme', () => {
  test.skip(!wantsRealOpenCode(), 'Requires OPENCOVE_TEST_USE_REAL_AGENTS=1')

  test('captures theme switching render state inside opencode tui', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TEST_USE_REAL_AGENTS: '1' },
    })

    try {
      await clearAndSeedWorkspace(window, [], {
        settings: {
          uiTheme: 'dark',
        },
      })

      const flowPane = window.locator('.react-flow__pane').first()
      await expect(flowPane).toBeVisible()
      await flowPane.click({ button: 'right', position: { x: 260, y: 180 } })

      const providerToggle = window.locator(
        '[data-testid="workspace-context-run-agent-provider-toggle"]',
      )
      await expect(providerToggle).toBeVisible()
      await providerToggle.click()

      const opencodeAction = window.locator('[data-testid="workspace-context-run-agent-opencode"]')
      await expect(opencodeAction).toBeVisible()
      await opencodeAction.click()

      const terminalNode = window.locator('.terminal-node').first()
      const terminalBody = terminalNode.locator('.terminal-node__terminal')
      await expect(terminalBody).toBeVisible()

      await expect
        .poll(() =>
          terminalBody
            .evaluate(node => node.getAttribute('aria-busy') ?? 'true')
            .catch(() => 'true'),
        )
        .toBe('false')

      const darkScreenshotPath = testInfo.outputPath('opencode-embedded-dark.png')
      await window.screenshot({ path: darkScreenshotPath })
      await testInfo.attach('opencode-embedded-dark', {
        path: darkScreenshotPath,
        contentType: 'image/png',
      })

      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      await settingsButton.click({ noWaitAfter: true })

      await selectCoveOption(window, 'settings-ui-theme', 'light')

      await expect
        .poll(() =>
          window.evaluate(() => {
            return document.documentElement.dataset.coveTheme ?? null
          }),
        )
        .toBe('light')

      await window.locator('.settings-panel__close').click()

      await window.waitForTimeout(750)

      const lightScreenshotPath = testInfo.outputPath('opencode-embedded-light.png')
      await window.screenshot({ path: lightScreenshotPath })
      await testInfo.attach('opencode-embedded-light', {
        path: lightScreenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
