import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

function extractLastRunId(text: string): string | null {
  const matches = [...text.matchAll(/\[opencove-test-color\]\s+runId=(\d+)\s+done/g)]
  return matches.length > 0 ? (matches[matches.length - 1]?.[1] ?? null) : null
}

async function readFirstAgentSessionId(
  window: import('@playwright/test').Page,
): Promise<string | null> {
  const parsed = await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  })

  const nodes =
    typeof parsed === 'object' && parsed !== null
      ? ((
          parsed as {
            workspaces?: Array<{ nodes?: Array<{ kind?: unknown; sessionId?: unknown }> }>
          }
        ).workspaces?.[0]?.nodes ?? [])
      : []

  const agent = nodes.find(node => node?.kind === 'agent')
  const sessionId = agent?.sessionId

  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : null
}

async function expectColorProbeRendered(window: import('@playwright/test').Page): Promise<void> {
  const terminalNode = window.locator('.terminal-node').first()
  await expect(terminalNode).toBeVisible()

  const transcript = terminalNode.locator('.terminal-node__transcript')
  await expect(transcript).toContainText('[opencove-test-color] runId=', { timeout: 20_000 })

  const transcriptText = (await transcript.textContent()) ?? ''
  const runId = extractLastRunId(transcriptText)
  expect(runId, `Missing color probe run id in transcript:\n${transcriptText}`).not.toBeNull()

  const sessionId = await readFirstAgentSessionId(window)
  expect(
    sessionId,
    `Missing agent session id in persisted workspace state:\n${transcriptText}`,
  ).not.toBeNull()

  const snapshot = await window.evaluate(
    async payload => {
      const result = await window.opencoveApi.pty.snapshot({ sessionId: payload.sessionId })
      return result.data
    },
    { sessionId: sessionId as string },
  )

  const token = `COLOR_PROBE_${runId as string}`
  expect(snapshot).toContain(`\u001b[31m${token}\u001b[0m`)
}

test.describe('Recovery - Agent color probe', () => {
  test('keeps ANSI color output enabled after app restart', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'raw-color-probe',
        },
      })

      try {
        await clearAndSeedWorkspace(window, [], {
          settings: {
            defaultProvider: 'codex',
            customModelEnabledByProvider: {
              'claude-code': false,
              codex: true,
            },
            customModelByProvider: {
              'claude-code': '',
              codex: 'gpt-5.2-codex',
            },
            customModelOptionsByProvider: {
              'claude-code': [],
              codex: ['gpt-5.2-codex'],
            },
          },
        })

        const pane = window.locator('.workspace-canvas .react-flow__pane')
        await expect(pane).toBeVisible()
        await pane.click({ button: 'right', position: { x: 320, y: 220 } })

        const runButton = window.locator('[data-testid="workspace-context-run-default-agent"]')
        await expect(runButton).toBeVisible()
        await runButton.click()

        await expectColorProbeRendered(window)
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'raw-color-probe',
        },
      })

      try {
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1)
        await expectColorProbeRendered(restartedWindow)
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
