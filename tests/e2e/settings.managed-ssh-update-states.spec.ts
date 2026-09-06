/* eslint-disable no-await-in-loop -- Advance the observable bootstrap stages in order. */
import { expect, test } from '@playwright/test'
import { withManagedSshProgress } from './managed-ssh-progress.fixture'

for (const scenario of [
  {
    language: 'zh-CN' as const,
    uiTheme: 'light' as const,
    failureKind: 'runtime_busy',
    status: '更新等待中',
    connect: '连接',
  },
  {
    language: 'en' as const,
    uiTheme: 'dark' as const,
    failureKind: 'recovery_required',
    status: 'Recovery required',
    connect: 'Connect',
  },
]) {
  test(`shows ${scenario.failureKind} without claiming the endpoint is connected`, async () => {
    const testInfo = test.info()
    test.setTimeout(90_000)
    await withManagedSshProgress(scenario, async fixture => {
      await fixture.card.getByRole('button', { name: scenario.connect, exact: true }).click()
      for (const phase of ['checking_remote_runtime', 'installing_runtime', 'starting_runtime']) {
        await fixture.waitForPhase(phase)
        await fixture.release(phase)
      }
      await expect(fixture.card.locator('.remote-endpoint-status__badge')).toHaveText(
        scenario.status,
      )
      await fixture.assertNoTunnel()
      await testInfo.attach('managed-runtime-update-state', {
        body: await fixture.card.screenshot(),
        contentType: 'image/png',
      })
    })
  })
}
