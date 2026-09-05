import { expect, test } from '@playwright/test'
import {
  closeSettings,
  openSettings,
  switchSettingsPage,
} from './m6.endpoints-mounts.integration.helpers'
import { withManagedSshProgress } from './managed-ssh-progress.fixture'

test.describe('Managed SSH cold bootstrap progress', () => {
  test.setTimeout(120_000)
  for (const [uiTheme, language] of [
    ['dark', 'en'],
    ['light', 'zh-CN'],
  ] as const) {
    test(`keeps accepted progress across Settings reopen (${uiTheme}, ${language})`, async ({
      browserName,
    }, testInfo) => {
      expect(browserName).toBe('chromium')
      await withManagedSshProgress({ uiTheme, language }, async h => {
        const { window, card } = h
        await card
          .getByRole('button', { name: language === 'en' ? 'Connect' : '连接', exact: true })
          .click()
        await h.waitForPhase('checking_remote_runtime')
        const panel = card.locator('.remote-endpoint-status')
        await expect(panel).toHaveAttribute('data-operation-phase', 'checking_remote_runtime')
        const operationId = await panel.getAttribute('data-operation-id')
        expect(operationId).toBeTruthy()
        await h.assertNoTunnel()
        await h.release('checking_remote_runtime')
        await h.waitForPhase('installing_runtime')
        const progressLabel =
          language === 'en' ? 'Installing remote components…' : '正在安装远程组件…'
        await expect(card.getByRole('progressbar', { name: progressLabel })).toBeVisible()
        await expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
        await expect(panel).toHaveAttribute('aria-busy', 'true')
        await expect(card).not.toContainText(
          /Worker is unavailable|Connection refused|tunnel_failed/,
        )
        await closeSettings(window)
        await openSettings(window)
        await switchSettingsPage(window, 'endpoints')
        await expect(panel).toHaveAttribute('data-operation-id', operationId!)
        await expect(card.getByRole('progressbar', { name: progressLabel })).toBeVisible()
        await testInfo.attach(`ssh-install-${uiTheme}-${language}`, {
          body: await card.screenshot(),
          contentType: 'image/png',
        })
        await window.emulateMedia({ reducedMotion: 'reduce' })
        await expect(card.locator('.remote-endpoint-status__spinner')).toHaveCSS(
          'animation-name',
          'none',
        )
        await h.release('installing_runtime')
        await h.waitForPhase('starting_runtime')
        await expect(panel).toHaveAttribute('data-operation-phase', 'starting_runtime')
        await h.assertNoTunnel()
        await h.startWorker()
        await h.release('starting_runtime')
        await expect(card).toContainText(language === 'en' ? 'Connected' : '已连接')
        await expect(card.getByRole('progressbar')).toHaveCount(0)
        await expect(panel).toHaveAttribute('aria-busy', 'false')
        await testInfo.attach(`ssh-connected-${uiTheme}-${language}`, {
          body: await card.screenshot(),
          contentType: 'image/png',
        })
      })
    })
  }
})
