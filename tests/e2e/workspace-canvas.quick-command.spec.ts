import { test } from '@playwright/test'
import { verifyTerminalQuickCommand } from './workspace-canvas.quick-command.helpers'

for (const scope of ['root', 'mount'] as const) {
  test(`executes a persisted terminal quick command once on the ${scope}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    test.skip(process.platform === 'win32', 'Covered by the Windows platform suite.')
    await verifyTerminalQuickCommand(scope, testInfo)
  })
}
