import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

function countOccurrences(value: string, token: string): number {
  return value.split(token).length - 1
}

test.describe('Recovery - Quit Persist Flush', () => {
  test('persists pending workspace state writes when quitting the app (Cmd+Q)', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          // Artificially slow persistence writes to deterministically reproduce "quit before write completes".
          OPENCOVE_TEST_PERSIST_APP_STATE_WRITE_DELAY_MS: '650',
        },
      })

      try {
        await clearAndSeedWorkspace(window, [])

        const pane = window.locator('.workspace-canvas .react-flow__pane')
        await expect(pane).toBeVisible()

        await pane.click({
          button: 'right',
          position: { x: 240, y: 180 },
        })

        await window.locator('[data-testid="workspace-context-new-note"]').click()
        await expect(window.locator('.note-node')).toHaveCount(1)

        // Simulate Cmd+Q by quitting from main. The app should block quit until persistence flush
        // completes, otherwise the note can be lost on restart.
        await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_PERSIST_APP_STATE_WRITE_DELAY_MS: '650',
        },
      })

      try {
        await expect(restartedWindow.locator('.note-node')).toHaveCount(1, { timeout: 30_000 })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })

  test('drains the final terminal output exactly once when quitting the app (Cmd+Q)', async () => {
    const userDataDir = await createTestUserDataDir()
    const nodeId = 'terminal-quit-tail'
    const tailToken = `OPENCOVE_QUIT_TERMINAL_TAIL_${Date.now()}`

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
      })

      try {
        await clearAndSeedWorkspace(window, [
          {
            id: nodeId,
            title: 'terminal-quit-tail',
            position: { x: 160, y: 140 },
            width: 520,
            height: 320,
            kind: 'terminal',
          },
        ])

        const terminal = window.locator('.terminal-node').first()
        const terminalBody = terminal.locator('.terminal-node__terminal')
        await expect(terminal).toBeVisible()
        await expect(terminal.locator('.xterm')).toBeVisible()
        await expect(terminalBody).toHaveAttribute('aria-busy', 'false')

        const readRuntimeSessionId = async () =>
          await window.evaluate(id => {
            return window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null
          }, nodeId)
        await expect.poll(readRuntimeSessionId).toBeTruthy()
        const sessionId = await readRuntimeSessionId()
        expect(sessionId).not.toBeNull()

        const command = buildNodeEvalCommand(
          `process.stdout.write(${JSON.stringify(tailToken)} + '\\n')`,
        )
        const baselineAppliedSeq = await window.evaluate(
          async payload => {
            const baseline = await window.opencoveApi.pty.presentationSnapshot({
              sessionId: payload.sessionId,
            })
            await window.opencoveApi.pty.write({
              sessionId: payload.sessionId,
              data: `${payload.command}\r`,
            })
            return baseline.appliedSeq
          },
          { sessionId: sessionId!, command },
        )

        await expect
          .poll(
            async () => {
              return await window.evaluate(
                async payload => {
                  const snapshot = await window.opencoveApi.pty.presentationSnapshot({
                    sessionId: payload.sessionId,
                  })
                  return {
                    tokenCount: snapshot.serializedScreen.split(payload.token).length - 1,
                    advancedPastBaseline: snapshot.appliedSeq > payload.baselineAppliedSeq,
                  }
                },
                { sessionId: sessionId!, token: tailToken, baselineAppliedSeq },
              )
            },
            { timeout: 10_000, intervals: [10, 20, 50, 100] },
          )
          .toEqual({ tokenCount: 1, advancedPastBaseline: true })

        const durableBeforeQuit = await window.evaluate(async id => {
          return (await window.opencoveApi.persistence.readNodeScrollback({ nodeId: id })) ?? ''
        }, nodeId)
        expect(countOccurrences(durableBeforeQuit, tailToken)).toBe(0)

        await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
      })

      try {
        const restartedTerminal = restartedWindow.locator('.terminal-node').first()
        await expect(restartedTerminal).toBeVisible()
        await expect(restartedTerminal.locator('.xterm')).toBeVisible()
        await expect(restartedTerminal.locator('.terminal-node__terminal')).toHaveAttribute(
          'aria-busy',
          'false',
        )
        await expect(restartedTerminal).toContainText(tailToken)

        await expect
          .poll(async () => {
            const recovered = await restartedWindow.evaluate(async id => {
              return (await window.opencoveApi.persistence.readNodeScrollback({ nodeId: id })) ?? ''
            }, nodeId)
            return countOccurrences(recovered, tailToken)
          })
          .toBe(1)
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
