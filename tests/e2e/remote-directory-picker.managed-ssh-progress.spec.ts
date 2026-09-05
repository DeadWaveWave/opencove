import { expect, test } from '@playwright/test'
import { closeSettings } from './m6.endpoints-mounts.integration.helpers'
import { selectCoveOption } from './workspace-canvas.helpers'
import { withManagedSshProgress } from './managed-ssh-progress.fixture'

test('Picker reopens an accepted cold bootstrap and automatically loads home when ready', async ({
  browserName,
}, testInfo) => {
  test.setTimeout(120_000)
  expect(browserName).toBe('chromium')
  await withManagedSshProgress({ uiTheme: 'dark', language: 'en' }, async h => {
    const { window } = h
    await closeSettings(window)
    await window.getByTestId('workspace-sidebar-add-project').click()
    await window.getByTestId('workspace-project-create-default-location-remote').click()
    await selectCoveOption(window, 'workspace-project-create-default-remote-endpoint', h.endpointId)
    const browse = window.getByTestId('workspace-project-create-default-remote-browse')
    await browse.click()
    const panel = window.getByTestId('remote-directory-picker-status-panel')
    await h.waitForPhase('checking_remote_runtime')
    await expect(panel).toHaveAttribute('data-operation-phase', 'checking_remote_runtime')
    const operationId = await panel.getAttribute('data-operation-id')
    await h.release('checking_remote_runtime')
    await h.waitForPhase('installing_runtime')
    await expect(panel.getByRole('progressbar')).toHaveAccessibleName(
      'Installing remote components…',
    )
    await window.getByTestId('remote-directory-picker-cancel').click()
    await expect(window.getByTestId('remote-directory-picker-window')).toHaveCount(0)
    await browse.click()
    await expect(panel).toHaveAttribute('data-operation-id', operationId!)
    await expect(window.getByTestId('remote-directory-picker-path')).toBeDisabled()
    await testInfo.attach('picker-installing', {
      body: await window.getByTestId('remote-directory-picker-window').screenshot(),
      contentType: 'image/png',
    })
    await h.assertNoTunnel()
    await h.release('installing_runtime')
    await h.waitForPhase('starting_runtime')
    await h.startWorker()
    await h.release('starting_runtime')
    await expect(window.getByTestId('remote-directory-picker-path')).toHaveValue(
      h.remoteHome.replaceAll('\\', '/'),
    )
    await expect(window.getByTestId('remote-directory-picker-select')).toBeEnabled()
    await expect(window.getByTestId('remote-directory-picker-entry-0')).toContainText('project')
    await testInfo.attach('picker-ready', {
      body: await window.getByTestId('remote-directory-picker-window').screenshot(),
      contentType: 'image/png',
    })
  })
})
