import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
} from './workspace-canvas.helpers'

const restoredAgentTestEnv = {
  OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
  OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'jsonl-stdin-submit-driven-turn',
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

async function sampleTranscript(
  window: Page,
  transcript: Locator,
  durationMs: number,
  intervalMs = 120,
  options?: { nodeId?: string | null },
): Promise<string[]> {
  const deadline = Date.now() + durationMs

  const readCurrentSample = async (): Promise<string> => {
    if (options?.nodeId) {
      const mirroredText = await window.evaluate(nodeId => {
        const reader = (
          window as Window & {
            __OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__?: (currentNodeId: string) => string
          }
        ).__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__
        return typeof reader === 'function' ? reader(nodeId) : ''
      }, options.nodeId)
      if (mirroredText.trim().length > 0) {
        return mirroredText.trim()
      }
    }

    return ((await transcript.textContent()) ?? '').trim()
  }

  const collectSamples = async (samples: string[]): Promise<string[]> => {
    if (Date.now() >= deadline) {
      return samples
    }

    samples.push(await readCurrentSample())
    await window.waitForTimeout(intervalMs)
    return collectSamples(samples)
  }

  return collectSamples([])
}

async function waitForNonEmptyTranscript(transcript: Locator): Promise<string> {
  const deadline = Date.now() + 15_000
  const poll = async (): Promise<string> => {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for a non-empty transcript')
    }

    const text = ((await transcript.textContent()) ?? '').trim()
    if (text.length > 0) {
      return text
    }

    await transcript.page().waitForTimeout(120)
    return poll()
  }

  return poll()
}

function expectNoMidstreamTranscriptBlanking(samples: string[], context: string): void {
  const firstNonEmptyIndex = samples.findIndex(sample => sample.length > 0)
  const relevantSamples = firstNonEmptyIndex >= 0 ? samples.slice(firstNonEmptyIndex) : samples
  const transientBlankIndexes = relevantSamples
    .map((sample, index) => ({ sample, index }))
    .filter(entry => entry.sample.length === 0)
    .map(entry => entry.index)

  expect(
    transientBlankIndexes.length <= 1 &&
      transientBlankIndexes.every(index => {
        const previousSample = relevantSamples[index - 1] ?? ''
        const nextSample = relevantSamples[index + 1] ?? ''
        return previousSample.length > 0 && nextSample.length > 0
      }),
    `${context}: ${JSON.stringify(samples)}`,
  ).toBe(true)
}

async function prepareRestorableAgent(
  userDataDir: string,
  env: Record<string, string> = restoredAgentTestEnv,
): Promise<void> {
  const { electronApp, window } = await launchApp({
    windowMode: 'offscreen',
    userDataDir,
    cleanupUserDataDir: false,
    env,
  })

  try {
    await clearAndSeedWorkspace(window, [], {
      settings: restoredAgentSettings,
    })

    const pane = window.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 320, y: 220 } })

    const runButton = window.locator('[data-testid="workspace-context-run-default-agent"]')
    await expect(runButton).toBeVisible()
    await runButton.click()

    const agentNode = window.locator('.terminal-node').first()
    const nodeStatus = agentNode.locator('.terminal-node__status')
    const transcript = agentNode.locator('.terminal-node__transcript')
    await expect(agentNode).toBeVisible()
    await expect(nodeStatus).toHaveText('Standby')
    await waitForNonEmptyTranscript(transcript)

    const agentBinding = await resolveSingleAgentBinding(window)
    if (!agentBinding.nodeId || !agentBinding.sessionId) {
      throw new Error('Failed to resolve launched agent binding before restart')
    }

    const snapshot = await window.evaluate(
      async payload => {
        const result = await window.opencoveApi.pty.snapshot({ sessionId: payload.sessionId })
        await window.opencoveApi.persistence.writeAgentNodePlaceholderScrollback({
          nodeId: payload.nodeId,
          scrollback: result.data,
        })
        return result.data
      },
      { nodeId: agentBinding.nodeId, sessionId: agentBinding.sessionId },
    )

    expect(snapshot.trim().length).toBeGreaterThan(0)
  } finally {
    await electronApp.close()
  }
}

test.describe('Recovery - Agent placeholder handoff interaction', () => {
  test('keeps restored history visible and preserves first-click focus across placeholder to runtime handoff', async () => {
    const userDataDir = await createTestUserDataDir()

    try {
      await prepareRestorableAgent(userDataDir)

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: restoredAgentTestEnv,
      })

      try {
        const agentNode = restartedWindow.locator('.terminal-node').first()
        const nodeStatus = agentNode.locator('.terminal-node__status')
        const terminalBody = agentNode.locator('.xterm')
        const helper = agentNode.locator('.xterm-helper-textarea')
        const transcript = agentNode.locator('.terminal-node__transcript')

        await expect(agentNode).toBeVisible({ timeout: 30_000 })
        await waitForNonEmptyTranscript(transcript)
        const binding = await resolveSingleAgentBinding(restartedWindow)

        await terminalBody.click()
        await expect(helper).toBeFocused()

        const transcriptSamplesDuringHandoff = await sampleTranscript(
          restartedWindow,
          transcript,
          4_000,
          120,
          { nodeId: binding.nodeId },
        )

        expect(transcriptSamplesDuringHandoff.some(sample => sample.length > 0)).toBe(true)
        expectNoMidstreamTranscriptBlanking(
          transcriptSamplesDuringHandoff,
          'Transcript blanked for longer than a transient sample during placeholder/runtime handoff',
        )

        await expect(helper).toBeFocused()
        await restartedWindow.keyboard.type('1')
        await restartedWindow.keyboard.press('Enter')

        await expect(nodeStatus).not.toHaveText('Failed')
        await expect(nodeStatus).toHaveText('Standby', { timeout: 15_000 })
        await expect(helper).toBeFocused()
        await expect(transcript).toContainText('1', { timeout: 10_000 })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })

  test('forwards the very first typed input even when the user types during the placeholder phase', async () => {
    const userDataDir = await createTestUserDataDir()
    const stdinEchoEnv = {
      OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'stdin-echo',
    }

    try {
      await prepareRestorableAgent(userDataDir, stdinEchoEnv)

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: stdinEchoEnv,
      })

      try {
        const agentNode = restartedWindow.locator('.terminal-node').first()
        const nodeStatus = agentNode.locator('.terminal-node__status')
        const terminalBody = agentNode.locator('.xterm')
        const helper = agentNode.locator('.xterm-helper-textarea')
        const transcript = agentNode.locator('.terminal-node__transcript')

        await expect(agentNode).toBeVisible({ timeout: 30_000 })
        await waitForNonEmptyTranscript(transcript)
        const binding = await resolveSingleAgentBinding(restartedWindow)

        await terminalBody.click()
        await expect(helper).toBeFocused()

        await restartedWindow.keyboard.type('1')
        await restartedWindow.keyboard.press('Enter')

        const transcriptSamplesDuringHandoff = await sampleTranscript(
          restartedWindow,
          transcript,
          4_000,
          120,
          { nodeId: binding.nodeId },
        )

        expect(transcriptSamplesDuringHandoff.some(sample => sample.length > 0)).toBe(true)
        expectNoMidstreamTranscriptBlanking(
          transcriptSamplesDuringHandoff,
          'Transcript blanked for longer than a transient sample during placeholder/runtime handoff',
        )

        await expect(transcript).toContainText(/stdin_hex=31(?:0a|0d)/, { timeout: 10_000 })
        await expect(helper).toBeFocused()
        await expect(nodeStatus).not.toHaveText('Failed')
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
