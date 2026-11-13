import { expect, test } from '@playwright/test'
import { createTestUserDataDir, removePathWithRetry } from '../../e2e/workspace-canvas.helpers'
import { startWorker, stopWorker } from '../../e2e/worker-client.helpers'
import {
  createCommandPlugin,
  pluginCli,
  pluginCliFailure,
} from '../../e2e/plugins.commands.helpers'

test.describe('Independent plugin CLI and window ownership', () => {
  test('lists windows and runs backend commands before a fresh Worker has any project or UI', async () => {
    const source = await createCommandPlugin('single')
    const userDataDir = await createTestUserDataDir()
    const { child } = await startWorker({ userDataDir })
    try {
      await pluginCli(userDataDir, ['install', source.directory])
      expect(await pluginCli(userDataDir, ['windows', source.id])).toEqual({ windows: [] })
      expect(await pluginCliFailure(userDataDir, ['open', source.id])).toContain('--project')
      expect(await pluginCli(userDataDir, ['run', source.id, 'inspect'])).toMatchObject({
        pluginId: source.id,
        hasWindow: false,
      })
      expect(await pluginCli(userDataDir, ['windows', source.id])).toEqual({ windows: [] })
    } finally {
      await stopWorker(child)
      await removePathWithRetry(source.directory)
      await removePathWithRetry(userDataDir)
    }
  })
})
