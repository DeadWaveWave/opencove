import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

const restoredAgentTestEnv = {
  OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
  OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'jsonl-stdin-submit-driven-turn',
  OPENCOVE_TEST_KEEP_APP_ALIVE_ON_WINDOW_ALL_CLOSED: '1',
} as const

const restoredAgentSettings = {
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
} as const

async function resolveSingleAgentBinding(window: Page): Promise<{
  nodeId: string | null
  sessionId: string | null
}> {
  const raw = await window.evaluate(async () => {
    return await window.opencoveApi.persistence.readWorkspaceStateRaw()
  })

  if (!raw) {
    return { nodeId: null, sessionId: null }
  }

  const parsed = JSON.parse(raw) as {
    workspaces?: Array<{
      nodes?: Array<{
        id?: string
        kind?: string
        sessionId?: string
      }>
    }>
  }
  const agent = parsed.workspaces?.[0]?.nodes?.find(node => node.kind === 'agent')

  return {
    nodeId: typeof agent?.id === 'string' && agent.id.length > 0 ? agent.id : null,
    sessionId:
      typeof agent?.sessionId === 'string' && agent.sessionId.trim().length > 0
        ? agent.sessionId
        : null,
  }
}

async function readTranscript(window: Page, nodeId: string, transcript?: Locator): Promise<string> {
  const mirroredText = await window.evaluate(currentNodeId => {
    const reader = (
      window as Window & {
        __OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__?: (targetNodeId: string) => string
      }
    ).__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__
    return typeof reader === 'function' ? reader(currentNodeId) : ''
  }, nodeId)

  if (mirroredText.trim().length > 0 || !transcript) {
    return mirroredText
  }

  return ((await transcript.textContent()) ?? '').trim()
}

function resolveStableTranscriptMarker(transcript: string): string {
  return (
    transcript
      .split('\n')
      .map(line => line.trim())
      .reverse()
      .find(line => line.length > 0) ?? transcript.trim()
  )
}

function resolveLastNonEmptyTranscriptLine(transcript: string): string {
  return (
    transcript
      .split('\n')
      .map(line => line.trim())
      .reverse()
      .find(line => line.length > 0) ?? ''
  )
}

async function sampleTranscript(
  window: Page,
  nodeId: string,
  transcript: Locator,
  durationMs: number,
  intervalMs = 120,
): Promise<string[]> {
  const deadline = Date.now() + durationMs
  const samples: string[] = []

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    samples.push((await readTranscript(window, nodeId, transcript)).trim())
    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    await window.waitForTimeout(intervalMs)
  }

  return samples
}

async function waitForTranscriptContaining(
  window: Page,
  nodeId: string,
  matcher: string | RegExp,
  transcript?: Locator,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    const transcriptText = await readTranscript(window, nodeId, transcript)
    const matches =
      typeof matcher === 'string' ? transcriptText.includes(matcher) : matcher.test(transcriptText)

    if (matches) {
      return transcriptText
    }

    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    await window.waitForTimeout(120)
  }

  throw new Error(`Timed out waiting for transcript match: ${String(matcher)}`)
}

async function waitForLastTranscriptLineContaining(
  window: Page,
  nodeId: string,
  matcher: string | RegExp,
  transcript: Locator,
  timeoutMs = 1_500,
): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    const transcriptText = await readTranscript(window, nodeId, transcript)
    const lastLine = resolveLastNonEmptyTranscriptLine(transcriptText)
    const matches =
      typeof matcher === 'string' ? lastLine.includes(matcher) : matcher.test(lastLine)

    if (matches) {
      return lastLine
    }

    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    await window.waitForTimeout(50)
  }

  throw new Error(`Timed out waiting for last transcript line match: ${String(matcher)}`)
}

async function waitForBrowserWindowCount(
  electronApp: ElectronApplication,
  expectedCount: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    const count = await electronApp.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).length
    })

    if (count === expectedCount) {
      return
    }

    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    await new Promise(resolve => {
      setTimeout(resolve, 100)
    })
  }

  throw new Error(`Timed out waiting for BrowserWindow count ${expectedCount}`)
}

async function waitForOpenWindow(
  electronApp: ElectronApplication,
  previousWindows: Page[],
  timeoutMs = 15_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const nextWindow =
      electronApp
        .windows()
        .find(window => !window.isClosed() && !previousWindows.includes(window)) ?? null

    if (nextWindow) {
      // eslint-disable-next-line no-await-in-loop -- bounded UI polling
      await nextWindow.waitForLoadState('domcontentloaded')
      return nextWindow
    }

    // eslint-disable-next-line no-await-in-loop -- bounded UI polling
    await new Promise(resolve => {
      setTimeout(resolve, 100)
    })
  }

  throw new Error('Timed out waiting for a reopened BrowserWindow')
}

async function prepareReopenedAgentWindow(
  userDataDir: string,
  options?: { waitForRestoredTranscript?: boolean },
): Promise<{
  electronApp: ElectronApplication
  reopenedWindow: Page
  reopenedAgentNode: Locator
  reopenedHelper: Locator
  reopenedTranscriptLocator: Locator
  reopenedNodeId: string
  stableMarker: string
}> {
  const waitForRestoredTranscript = options?.waitForRestoredTranscript !== false
  const { electronApp, window: mainWindowPage } = await launchApp({
    windowMode: 'offscreen',
    userDataDir,
    cleanupUserDataDir: false,
    env: restoredAgentTestEnv,
  })

  try {
    await clearAndSeedWorkspace(mainWindowPage, [], {
      settings: restoredAgentSettings,
    })

    const pane = mainWindowPage.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 320, y: 220 } })

    const runButton = mainWindowPage.locator('[data-testid="workspace-context-run-default-agent"]')
    await expect(runButton).toBeVisible()
    await runButton.click()

    const agentNode = mainWindowPage.locator('.terminal-node').first()
    const transcript = agentNode.locator('.terminal-node__transcript')
    await expect(agentNode).toBeVisible()
    await expect(agentNode.locator('.terminal-node__status')).toHaveText('Standby')

    const binding = await resolveSingleAgentBinding(mainWindowPage)
    if (!binding.nodeId || !binding.sessionId) {
      throw new Error('Failed to resolve launched agent binding before window reopen')
    }

    const initialTranscript = await waitForTranscriptContaining(
      mainWindowPage,
      binding.nodeId,
      /.+/,
      transcript,
    )
    const stableMarker = resolveStableTranscriptMarker(initialTranscript)
    const previousWindows = electronApp.windows().filter(page => !page.isClosed())

    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows().find(
        candidate => !candidate.isDestroyed(),
      )
      if (!browserWindow) {
        throw new Error('Unable to resolve BrowserWindow for close/reopen test')
      }

      browserWindow.close()
    })

    await waitForBrowserWindowCount(electronApp, 0)

    await electronApp.evaluate(({ app }) => {
      app.emit('activate')
    })

    await waitForBrowserWindowCount(electronApp, 1)
    const reopenedWindow = await waitForOpenWindow(electronApp, previousWindows)
    const reopenedAgentNode = reopenedWindow.locator('.terminal-node').first()
    const reopenedHelper = reopenedAgentNode.locator('.xterm-helper-textarea')
    const reopenedTranscriptLocator = reopenedAgentNode.locator('.terminal-node__transcript')

    await expect(reopenedAgentNode).toBeVisible({ timeout: 30_000 })
    const reopenedBinding = await resolveSingleAgentBinding(reopenedWindow)
    const reopenedNodeId = reopenedBinding.nodeId ?? binding.nodeId
    if (waitForRestoredTranscript) {
      const reopenedTranscript = await waitForTranscriptContaining(
        reopenedWindow,
        reopenedNodeId,
        /.+/,
        reopenedTranscriptLocator,
      )
      expect(reopenedTranscript).toContain(stableMarker)

      await reopenedAgentNode.locator('.xterm').click()
      await expect(reopenedHelper).toBeFocused()
    }

    return {
      electronApp,
      reopenedWindow,
      reopenedAgentNode,
      reopenedHelper,
      reopenedTranscriptLocator,
      reopenedNodeId,
      stableMarker,
    }
  } catch (error) {
    await electronApp.close().catch(() => undefined)
    throw error
  }
}

test.describe('Recovery - Agent input after window reopen', () => {
  test('remains interactive after closing the main window and reopening the app', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const {
        electronApp,
        reopenedWindow,
        reopenedHelper,
        reopenedTranscriptLocator,
        reopenedNodeId,
        stableMarker,
      } = await prepareReopenedAgentWindow(userDataDir)

      try {
        await reopenedWindow.keyboard.type('1')
        await reopenedWindow.keyboard.press('Enter')

        const transcriptSamplesAfterInput = await sampleTranscript(
          reopenedWindow,
          reopenedNodeId,
          reopenedTranscriptLocator,
          2_500,
        )
        expect(transcriptSamplesAfterInput.some(sample => sample.includes(stableMarker))).toBe(true)
        expect(
          transcriptSamplesAfterInput.filter(sample => sample.length === 0),
          `Transcript unexpectedly blanked after first input: ${JSON.stringify(transcriptSamplesAfterInput)}`,
        ).toHaveLength(0)

        const finalTranscript = await waitForTranscriptContaining(
          reopenedWindow,
          reopenedNodeId,
          '1',
          reopenedTranscriptLocator,
        )
        expect(finalTranscript).toContain(stableMarker)
        await expect(reopenedHelper).toBeFocused()
      } finally {
        await electronApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })

  test('applies backspace redraw without a multi-second delay after window reopen', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const {
        electronApp,
        reopenedWindow,
        reopenedHelper,
        reopenedTranscriptLocator,
        reopenedNodeId,
      } = await prepareReopenedAgentWindow(userDataDir)

      try {
        await reopenedWindow.keyboard.type('12')
        const lineWithTwoChars = await waitForLastTranscriptLineContaining(
          reopenedWindow,
          reopenedNodeId,
          '12',
          reopenedTranscriptLocator,
        )
        expect(lineWithTwoChars).toContain('12')

        await reopenedWindow.keyboard.press('Backspace')

        const lineAfterBackspace = await waitForLastTranscriptLineContaining(
          reopenedWindow,
          reopenedNodeId,
          /\b1\b/u,
          reopenedTranscriptLocator,
        )
        expect(lineAfterBackspace).not.toContain('12')
        await expect(reopenedHelper).toBeFocused()
      } finally {
        await electronApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })

  test('does not blank restored history when the first input happens immediately after reopen', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      const {
        electronApp,
        reopenedWindow,
        reopenedAgentNode,
        reopenedHelper,
        reopenedTranscriptLocator,
        reopenedNodeId,
        stableMarker,
      } = await prepareReopenedAgentWindow(userDataDir, {
        waitForRestoredTranscript: false,
      })

      try {
        await reopenedAgentNode.locator('.xterm').click()
        await expect(reopenedHelper).toBeFocused()

        await reopenedWindow.keyboard.type('1')
        await reopenedWindow.keyboard.press('Enter')

        const transcriptSamplesAfterImmediateInput = await sampleTranscript(
          reopenedWindow,
          reopenedNodeId,
          reopenedTranscriptLocator,
          2_500,
        )
        expect(
          transcriptSamplesAfterImmediateInput.filter(sample => sample.length === 0),
          `Transcript unexpectedly blanked after immediate reopen input: ${JSON.stringify(transcriptSamplesAfterImmediateInput)}`,
        ).toHaveLength(0)

        const finalTranscript = await waitForTranscriptContaining(
          reopenedWindow,
          reopenedNodeId,
          '1',
          reopenedTranscriptLocator,
        )
        expect(finalTranscript).toContain(stableMarker)
        await expect(reopenedHelper).toBeFocused()
      } finally {
        await electronApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
