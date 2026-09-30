import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { copyPluginFixture } from './plugins.local.helpers'

function git(directory: string, args: string[]): void {
  execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' })
}

test('installs a ready local directory through the plugin manager', async ({
  browserName: _browserName,
}) => {
  const directory = await copyPluginFixture()
  const { electronApp, window: page } = await launchApp()
  try {
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en' } })
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId('settings-plugins-install').click()
    await page.getByRole('button', { name: 'Local directory', exact: true }).click()
    await page.getByTestId('settings-plugin-install-source').fill(directory)
    await page.getByTestId('settings-plugin-install-submit').click()
    await expect(page.getByTestId('settings-plugin-install-panel')).toHaveCount(0)
    await expect(page.getByTestId('settings-plugin-details-hello-clock')).toBeVisible()
    await expect(page.getByTestId('settings-plugins-empty')).toHaveCount(0)
  } finally {
    await electronApp.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('installs, explicitly updates and restores Git plugin code through settings', async ({
  browserName: _browserName,
}, testInfo) => {
  const directory = await copyPluginFixture()
  git(directory, ['init', '-b', 'main'])
  git(directory, ['config', 'user.email', 'plugin-fixture@example.invalid'])
  git(directory, ['config', 'user.name', 'Plugin fixture'])
  git(directory, ['add', '.'])
  git(directory, ['commit', '-m', 'Initial fixture'])
  const { electronApp, window: page } = await launchApp()
  try {
    await page.setViewportSize({ width: 1400, height: 1000 })
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en', uiTheme: 'pixel' } })
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId('settings-plugins-install').click()
    await page.getByTestId('settings-plugin-install-source').fill(directory)
    await page.getByTestId('settings-plugin-install-submit').click()
    await expect(page.getByTestId('settings-plugin-install-panel')).toHaveCount(0)
    await page.getByTestId('settings-plugin-details-hello-clock').click()
    const detail = page.getByTestId('settings-plugin-detail-hello-clock')
    await expect(detail).toContainText('0.1.0')
    await expect(page.getByTestId('settings-plugin-check-update')).toBeVisible()
    const manifestPath = join(directory, 'opencove.plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string }
    manifest.version = '0.2.0'
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    git(directory, ['add', '.'])
    git(directory, ['commit', '-m', 'Update fixture'])
    await page.getByTestId('settings-plugin-check-update').click()
    await expect(page.getByTestId('settings-plugin-apply-update')).toBeVisible()
    await expect(detail).toContainText('0.1.0')
    const screenshot = '/tmp/opencove-plugin-library-review/plugin-git-update-dark.png'
    await page.screenshot({ path: screenshot })
    await testInfo.attach('plugin-git-update-dark', { path: screenshot, contentType: 'image/png' })
    await page.getByTestId('settings-plugin-apply-update').click()
    await expect(detail.locator('.settings-plugin-detail__identity')).toContainText('0.2.0')
    await page.getByText('Previous versions', { exact: true }).click()
    await page.getByRole('button', { name: 'Saved version', exact: true }).click()
    await page.getByRole('option', { name: /^0\.1\.0/ }).click()
    await page.getByRole('button', { name: 'Restore version', exact: true }).click()
    await expect(detail.locator('.settings-plugin-detail__identity')).toContainText('0.1.0')
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await electronApp.close()
    await rm(directory, { recursive: true, force: true })
  }
})
