import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  installPtySessionCapture,
  readObservedResumeSessionId,
  resolveFirstAgentSessionId,
  writeGeminiSessionFile,
  writeToPty,
} from './workspace-canvas.agent-status-watcher.helpers'

async function seedGeminiWorkspace(
  window: Awaited<ReturnType<typeof launchApp>>['window'],
  {
    resumeSessionId,
    startedAtMs,
  }: {
    resumeSessionId: string
    startedAtMs: number
  },
) {
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: 'agent-gemini-existing',
        title: 'gemini · existing session',
        position: { x: 320, y: 220 },
        width: 520,
        height: 320,
        kind: 'agent',
        status: 'standby',
        startedAt: new Date(startedAtMs).toISOString(),
        agent: {
          provider: 'gemini',
          prompt: 'Resume the existing session',
          model: 'gemini-3-flash-preview',
          effectiveModel: 'gemini-3-flash-preview',
          launchMode: 'resume',
          resumeSessionId,
          resumeSessionIdVerified: true,
          executionDirectory: testWorkspacePath,
          expectedDirectory: testWorkspacePath,
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
      },
    ],
    {
      settings: {
        defaultProvider: 'gemini',
        customModelEnabledByProvider: {
          'claude-code': false,
          codex: false,
          opencode: false,
          gemini: true,
        },
        customModelByProvider: {
          'claude-code': '',
          codex: '',
          opencode: '',
          gemini: 'gemini-3-flash-preview',
        },
        customModelOptionsByProvider: {
          'claude-code': [],
          codex: [],
          opencode: [],
          gemini: ['gemini-3-flash-preview'],
        },
      },
    },
  )
}

async function seedExistingGeminiRealTurnSession(userDataDir: string): Promise<void> {
  const startedAtMs = Date.now() - 4_000
  const replyAtMs = startedAtMs + 1_200
  const geminiProjectDir = path.join(userDataDir, 'home', '.gemini', 'tmp', 'existing-session')
  const chatsDir = path.join(geminiProjectDir, 'chats')

  await mkdir(chatsDir, { recursive: true })
  await writeFile(path.join(geminiProjectDir, '.project_root'), testWorkspacePath, 'utf8')
  await writeFile(
    path.join(chatsDir, 'session-existing.json'),
    JSON.stringify(
      {
        sessionId: 'existing-real-turn-session',
        projectHash: 'existing-project-hash',
        startTime: new Date(startedAtMs).toISOString(),
        lastUpdated: new Date(replyAtMs).toISOString(),
        kind: 'main',
        messages: [
          {
            id: `user-${startedAtMs}`,
            timestamp: new Date(startedAtMs).toISOString(),
            type: 'user',
            content: [{ text: 'old prompt' }],
          },
          {
            id: `gemini-${replyAtMs}`,
            timestamp: new Date(replyAtMs).toISOString(),
            type: 'gemini',
            content: 'old reply',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )
}

test.describe('Workspace Canvas - Agent Status Watcher (Gemini)', () => {
  test.describe.configure({ retries: 1 })

  test('keeps a resumed gemini session in standby while typing and switches after submit', async () => {
    test.skip(
      process.platform === 'win32',
      'Windows offscreen Playwright input does not reliably submit the Gemini stub prompt.',
    )

    const userDataDir = await createTestUserDataDir()
    const { electronApp, window } = await launchApp({
      windowMode: 'offscreen',
      userDataDir,
      env: {
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      },
    })

    try {
      const geminiSessionId = `gemini-e2e-${Date.now()}`
      const startedAtMs = Date.now()
      await writeGeminiSessionFile({
        userDataDir,
        cwd: testWorkspacePath,
        sessionId: geminiSessionId,
        startedAtMs,
        messages: [],
      })
      await installPtySessionCapture(window)
      await seedGeminiWorkspace(window, { resumeSessionId: geminiSessionId, startedAtMs })

      const agentNode = window.locator('.terminal-node').first()
      const xterm = agentNode.locator('.xterm')
      const nodeStatus = agentNode.locator('.terminal-node__status')
      const sidebarStatus = window
        .locator('.workspace-sidebar .workspace-agent-item .workspace-agent-item__status--agent')
        .first()

      await expect(agentNode).toBeVisible()
      await expect(xterm).toBeVisible()
      await expect(nodeStatus).toHaveText('Standby')
      await expect(sidebarStatus).toHaveText('Standby')

      await expect
        .poll(async () => {
          return await resolveFirstAgentSessionId(window)
        })
        .not.toBeNull()

      const sessionId = await resolveFirstAgentSessionId(window)
      if (!sessionId) {
        throw new Error('Failed to resolve the resumed Gemini PTY session id')
      }

      await expect
        .poll(async () => await readObservedResumeSessionId(window, sessionId))
        .toBe(geminiSessionId)

      await writeToPty(window, {
        sessionId,
        data: 'Return OK only.',
      })
      await window.waitForTimeout(900)

      await expect(nodeStatus).toHaveText('Standby')
      await expect(sidebarStatus).toHaveText('Standby')

      await writeToPty(window, {
        sessionId,
        data: '\r',
      })

      await writeGeminiSessionFile({
        userDataDir,
        cwd: testWorkspacePath,
        sessionId: geminiSessionId,
        startedAtMs,
        messages: [
          {
            type: 'user',
            content: [{ text: 'Return OK only.' }],
            timestampMs: startedAtMs + 50,
          },
        ],
      })

      await expect
        .poll(async () => {
          return await readObservedResumeSessionId(window, sessionId)
        })
        .toBe(geminiSessionId)

      await expect(nodeStatus).toHaveText('Working', { timeout: 15_000 })
      await expect(sidebarStatus).toHaveText('Working')

      await writeGeminiSessionFile({
        userDataDir,
        cwd: testWorkspacePath,
        sessionId: geminiSessionId,
        startedAtMs,
        summary: 'Return OK only.',
        messages: [
          {
            type: 'user',
            content: [{ text: 'Return OK only.' }],
            timestampMs: startedAtMs + 50,
          },
          {
            type: 'gemini',
            content: 'OK',
            timestampMs: startedAtMs + 1_250,
          },
        ],
      })

      await expect(nodeStatus).toHaveText('Standby', { timeout: 15_000 })
      await expect(sidebarStatus).toHaveText('Standby')
    } finally {
      await electronApp.close()
    }
  })

  test('keeps an explicit resumed gemini binding when an older session already exists', async () => {
    test.skip(
      process.platform === 'win32',
      'Windows offscreen Playwright input does not reliably submit the Gemini stub prompt.',
    )

    const userDataDir = await createTestUserDataDir()
    const { electronApp, window } = await launchApp({
      windowMode: 'offscreen',
      userDataDir,
      env: {
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      },
    })

    try {
      await seedExistingGeminiRealTurnSession(userDataDir)
      const geminiSessionId = `gemini-e2e-${Date.now()}`
      const startedAtMs = Date.now()
      await writeGeminiSessionFile({
        userDataDir,
        cwd: testWorkspacePath,
        sessionId: geminiSessionId,
        startedAtMs,
        messages: [],
      })
      await installPtySessionCapture(window)
      await seedGeminiWorkspace(window, { resumeSessionId: geminiSessionId, startedAtMs })

      const agentNode = window.locator('.terminal-node').first()
      const nodeStatus = agentNode.locator('.terminal-node__status')
      const sidebarStatus = window
        .locator('.workspace-sidebar .workspace-agent-item .workspace-agent-item__status--agent')
        .first()

      await expect(agentNode).toBeVisible()
      await expect(nodeStatus).toHaveText('Standby')
      await expect(sidebarStatus).toHaveText('Standby')

      await expect
        .poll(async () => {
          return await resolveFirstAgentSessionId(window)
        })
        .not.toBeNull()

      const sessionId = await resolveFirstAgentSessionId(window)
      if (!sessionId) {
        throw new Error('Failed to resolve the resumed Gemini PTY session id')
      }

      await expect
        .poll(async () => await readObservedResumeSessionId(window, sessionId))
        .toBe(geminiSessionId)

      await writeToPty(window, {
        sessionId,
        data: 'Return OK only.',
      })
      await writeToPty(window, {
        sessionId,
        data: '\r',
      })

      await writeGeminiSessionFile({
        userDataDir,
        cwd: testWorkspacePath,
        sessionId: geminiSessionId,
        startedAtMs,
        messages: [
          {
            type: 'user',
            content: [{ text: 'Return OK only.' }],
            timestampMs: startedAtMs + 50,
          },
        ],
      })

      await expect
        .poll(async () => {
          return await readObservedResumeSessionId(window, sessionId)
        })
        .toBe(geminiSessionId)

      await expect(nodeStatus).toHaveText('Working', { timeout: 15_000 })
      await expect(sidebarStatus).toHaveText('Working')

      await writeGeminiSessionFile({
        userDataDir,
        cwd: testWorkspacePath,
        sessionId: geminiSessionId,
        startedAtMs,
        summary: 'Return OK only.',
        messages: [
          {
            type: 'user',
            content: [{ text: 'Return OK only.' }],
            timestampMs: startedAtMs + 50,
          },
          {
            type: 'gemini',
            content: 'OK',
            timestampMs: startedAtMs + 1_250,
          },
        ],
      })

      await expect(nodeStatus).toHaveText('Standby', { timeout: 15_000 })
      await expect(sidebarStatus).toHaveText('Standby')
    } finally {
      await electronApp.close()
    }
  })
})
