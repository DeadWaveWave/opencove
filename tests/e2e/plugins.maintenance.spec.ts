import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { copyPluginFixture } from './plugins.local.helpers'

function commit(directory: string, message: string): void {
  execFileSync('git', ['-C', directory, 'add', '.'])
  execFileSync('git', [
    '-C',
    directory,
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'user.name=Fixture',
    'commit',
    '-m',
    message,
  ])
}

test('retains conflicting source, displays recovery, and applies the explicitly resolved candidate', async ({
  browserName: _browserName,
}, testInfo) => {
  const repository = await copyPluginFixture()
  execFileSync('git', ['-C', repository, 'init', '-b', 'main'])
  await writeFile(join(repository, 'personal.txt'), 'original\n')
  commit(repository, 'Initial')
  const { electronApp, window: page } = await launchApp()
  try {
    await page.setViewportSize({ width: 1300, height: 1000 })
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en', uiTheme: 'pixel' } })
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId('settings-plugins-install').click()
    await page.getByTestId('settings-plugin-install-source').fill(repository)
    await page.getByTestId('settings-plugin-install-submit').click()
    await expect(page.getByTestId('settings-plugin-install-panel')).toHaveCount(0)
    await page.getByTestId('settings-plugin-details-hello-clock').click()
    const source = await page.evaluate(() =>
      window.opencoveApi.controlSurface.invoke<{ sourceDirectory: string }>({
        kind: 'query',
        id: 'plugin.source',
        payload: { pluginId: 'hello-clock' },
      }),
    )
    await writeFile(join(source.sourceDirectory, 'personal.txt'), 'personal change\n')
    await writeFile(join(repository, 'personal.txt'), 'upstream change\n')
    commit(repository, 'Upstream')
    await page.getByTestId('settings-plugin-check-update').click()
    await page.getByTestId('settings-plugin-apply-update').click()
    await expect(page.getByTestId('settings-plugin-candidates')).toBeVisible()
    const inspected = await page.evaluate(() =>
      window.opencoveApi.controlSurface.invoke<{
        sourceDirectory: string
        candidates: Array<{ id: string; directory: string; stale: string | null }>
      }>({ kind: 'query', id: 'plugin.source', payload: { pluginId: 'hello-clock' } }),
    )
    expect(inspected.sourceDirectory).toBe(source.sourceDirectory)
    const candidate = inspected.candidates[0]
    expect(candidate.stale).toBeNull()
    await page.getByText('Inspect working copy', { exact: true }).click()
    await expect(page.getByText(candidate.directory, { exact: true })).toBeVisible()
    await page.getByTestId('settings-plugin-candidates').scrollIntoViewIfNeeded()
    const dark = testInfo.outputPath('plugin-candidate-dark.png')
    await page.screenshot({ path: dark })
    await testInfo.attach('plugin-candidate-dark', { path: dark, contentType: 'image/png' })
    await writeFile(join(candidate.directory, 'personal.txt'), 'reviewed resolution\n')
    commit(candidate.directory, 'Resolve explicitly')
    await page.getByTestId(`settings-plugin-candidate-apply-${candidate.id}`).click()
    await expect(page.getByTestId('settings-plugin-candidates')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    const current = await page.evaluate(() =>
      window.opencoveApi.controlSurface.invoke<{ sourceDirectory: string }>({
        kind: 'query',
        id: 'plugin.source',
        payload: { pluginId: 'hello-clock' },
      }),
    )
    expect(current.sourceDirectory).toBe(candidate.directory)
  } finally {
    await electronApp.close()
    await rm(repository, { recursive: true, force: true })
  }
})
