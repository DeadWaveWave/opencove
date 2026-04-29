import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'
import { startWorker, stopWorker } from './worker-client.helpers'

async function writeAgentPlaceholder(window: Page, nodeId: string, scrollback: string) {
  const result = await window.evaluate(
    async payload => {
      return await window.opencoveApi.persistence.writeAgentNodePlaceholderScrollback(payload)
    },
    { nodeId, scrollback },
  )

  expect(result.ok).toBe(true)
}

test.describe('Recovery - Worker client agent renderer restore', () => {
  test('does not render persisted agent placeholder scrollback via worker control-surface', async () => {
    const userDataDir = await createTestUserDataDir()
    let workerChild: ChildProcessWithoutNullStreams | null = null

    try {
      const worker = await startWorker({ userDataDir })
      workerChild = worker.child

      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_WORKER_CLIENT: '1',
        },
      })

      try {
        await clearAndSeedWorkspace(window, [
          {
            id: 'agent-one',
            title: 'agent-one',
            position: { x: 120, y: 140 },
            width: 520,
            height: 320,
            kind: 'agent',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- seed payload is intentionally loose
            // @ts-ignore
            sessionId: 'dummy-session-active',
          },
        ])

        await writeAgentPlaceholder(window, 'agent-one', 'WORKER_PLACEHOLDER\\r\\n')
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_WORKER_CLIENT: '1',
        },
      })

      try {
        await expect(restartedWindow.locator('.workspace-item')).toHaveCount(1)
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1)
        await expect(restartedWindow.locator('.terminal-node').first()).not.toContainText(
          'WORKER_PLACEHOLDER',
        )
      } finally {
        await restartedApp.close()
      }
    } finally {
      await stopWorker(workerChild)
      await removePathWithRetry(userDataDir)
    }
  })
})
