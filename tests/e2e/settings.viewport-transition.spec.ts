import { expect, test, type ElectronApplication } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  readCanvasViewport,
  removePathWithRetry,
  selectCoveOption,
} from './workspace-canvas.helpers'

test('restores the viewport preference after restart and exposes localized, searchable controls', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDir = await createTestUserDataDir()
  let electronApp: ElectronApplication | null = null
  try {
    let launched = await launchApp({ userDataDir, cleanupUserDataDir: false })
    electronApp = launched.electronApp
    let window = launched.window
    // Existing user data has no viewportTransition field.
    await clearAndSeedWorkspace(window, [])
    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-canvas').click()
    await expect(window.getByTestId('settings-viewport-transition-trigger')).toHaveText(
      'Zoom Flight',
    )
    const before = await readCanvasViewport(window)
    await selectCoveOption(window, 'settings-viewport-transition', 'slide')
    expect(await readCanvasViewport(window)).toEqual(before)
    await window.getByTestId('settings-section-nav-general').click()
    await selectCoveOption(window, 'settings-language', 'zh-CN')
    await window.getByTestId('settings-section-nav-appearance').click()
    await selectCoveOption(window, 'settings-ui-theme', 'light')
    await window.getByRole('searchbox').fill('平滑')
    await window.getByRole('searchbox').press('Enter')
    await expect(window.getByTestId('settings-viewport-transition-trigger')).toHaveText('平滑移动')
    await expect(window.getByTestId('settings-viewport-transition-trigger')).toHaveAttribute(
      'aria-label',
      '视口转移效果',
    )
    await testInfo.attach('settings-transition-light-zh', {
      body: await window.screenshot({ path: testInfo.outputPath('settings-light-zh.png') }),
      contentType: 'image/png',
    })
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          return raw ? JSON.parse(raw).settings?.viewportTransition : null
        }),
      )
      .toBe('slide')
    await electronApp.close()
    electronApp = null
    launched = await launchApp({ userDataDir, cleanupUserDataDir: false })
    electronApp = launched.electronApp
    window = launched.window
    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-canvas').click()
    await expect(window.getByTestId('settings-viewport-transition-trigger')).toHaveText('平滑移动')
    await selectCoveOption(window, 'settings-viewport-transition', 'fly')
    await expect(window.getByTestId('settings-viewport-transition-trigger')).toHaveText('缩放飞行')
  } finally {
    await electronApp?.close()
    await removePathWithRetry(userDataDir)
  }
})
