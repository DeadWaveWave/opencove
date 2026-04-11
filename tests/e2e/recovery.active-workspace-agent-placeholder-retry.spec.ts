import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

test.describe('Recovery - Active workspace placeholder retry', () => {
  test('retries loading agent placeholder scrollback for the initially active workspace', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
      })

      try {
        await clearAndSeedWorkspace(window, [
          {
            id: 'agent-active',
            title: 'agent-active',
            position: { x: 120, y: 140 },
            width: 520,
            height: 320,
            kind: 'agent',
            // Keep a non-empty session id so the terminal can render the placeholder without
            // depending on runtime hydration. The session itself does not need to exist.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- seed payload is intentionally loose
            // @ts-ignore
            sessionId: 'dummy-session-active',
          },
        ])

        const placeholderWriteResults = await window.evaluate(async () => {
          const active = await window.opencoveApi.persistence.writeAgentNodePlaceholderScrollback({
            nodeId: 'agent-active',
            scrollback: 'ACTIVE_PLACEHOLDER\\r\\n',
          })

          return { activeOk: active.ok }
        })
        expect(placeholderWriteResults).toEqual({ activeOk: true })
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
      })

      try {
        // Simulate a transient IPC/persistence read failure for the first placeholder read.
        await restartedWindow.addInitScript({
          content: `
            (() => {
              const targetNodeId = 'agent-active'
              let didFail = false

              const api = window.opencoveApi
              if (!api || !api.persistence) {
                return
              }

              const original = api.persistence.readAgentNodePlaceholderScrollback?.bind(api.persistence)
              if (typeof original !== 'function') {
                return
              }

              api.persistence.readAgentNodePlaceholderScrollback = async (payload) => {
                if (!didFail && payload && payload.nodeId === targetNodeId) {
                  didFail = true
                  throw new Error('Simulated placeholder read failure')
                }

                return await original(payload)
              }
            })()
          `,
        })

        await restartedWindow.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })

        await expect(restartedWindow.locator('.workspace-item')).toHaveCount(1)
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1)

        await expect(restartedWindow.locator('.terminal-node').first()).toContainText(
          'ACTIVE_PLACEHOLDER',
        )
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
