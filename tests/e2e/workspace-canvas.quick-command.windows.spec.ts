import { test } from '@playwright/test'
import { verifyTerminalQuickCommand } from './workspace-canvas.quick-command.helpers'

for (const scope of ['root', 'mount'] as const) {
  test(`submits a terminal quick command with Enter on the Windows ${scope}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    test.skip(process.platform !== 'win32', 'Windows platform regression.')
    await verifyTerminalQuickCommand(scope, testInfo)
  })
}
