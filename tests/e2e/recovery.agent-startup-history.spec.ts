import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { AgentRunSnapshot } from '../../src/shared/contracts/dto/agentRunState'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

async function state(window: Page): Promise<AgentRunSnapshot | null> {
  return await window.evaluate(() =>
    window.opencoveApi.controlSurface.invoke({
      kind: 'query',
      id: 'agent.get',
      payload: { nodeId: 'history-agent' },
    }),
  )
}

async function sounds(window: Page) {
  return await window.evaluate(
    () =>
      (
        window as unknown as {
          __opencoveNotificationSoundTestLog?: unknown[]
        }
      ).__opencoveNotificationSoundTestLog ?? [],
  )
}

for (const provider of ['claude-code', 'codex'] as const) {
  test(`${provider} folds saved history on cold restart and notifies once for the next turn`, async () => {
    const userDataDir = await createTestUserDataDir()
    const id = randomUUID()
    const home = path.join(userDataDir, 'home')
    const file =
      provider === 'claude-code'
        ? path.join(
            home,
            '.claude',
            'projects',
            path.resolve(testWorkspacePath).replace(/[^A-Za-z0-9]/gu, '-'),
            `${id}.jsonl`,
          )
        : path.join(home, '.codex', 'sessions', '2026', '01', '01', `rollout-${id}.jsonl`)
    const history =
      provider === 'claude-code'
        ? [
            { type: 'user', sessionId: id, message: { content: 'Old prompt' } },
            {
              type: 'assistant',
              sessionId: id,
              message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Old reply' }] },
            },
          ]
        : [
            { type: 'event_msg', payload: { type: 'task_started' } },
            { type: 'event_msg', payload: { type: 'task_complete' } },
          ]
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      [
        {
          type: 'session_meta',
          payload: { id, cwd: testWorkspacePath, timestamp: '2026-01-01T00:00:00Z' },
        },
        ...Array.from({ length: 800 }, () => history).flat(),
      ]
        .map(record => JSON.stringify(record))
        .join('\n') + '\n',
    )
    const options = {
      userDataDir,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'startup-history',
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: path.resolve(
          'tests/e2e/fixtures/agent-startup-history.mjs',
        ),
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_CODEX_HOOK_INSTALL_FAILURE: '0',
      },
    }
    try {
      const first = await launchApp(options)
      try {
        await clearAndSeedWorkspace(
          first.window,
          [
            {
              id: 'history-agent',
              kind: 'agent',
              title: provider,
              status: 'standby',
              position: { x: 180, y: 140 },
              width: 520,
              height: 360,
              executionDirectory: testWorkspacePath,
              agent: {
                provider,
                prompt: '',
                model: null,
                effectiveModel: null,
                launchMode: 'resume',
                resumeSessionId: id,
                resumeSessionIdVerified: true,
                executionDirectory: testWorkspacePath,
                expectedDirectory: testWorkspacePath,
                directoryMode: 'workspace',
                customDirectory: null,
                shouldCreateDirectory: false,
              },
            },
          ],
          {
            settings: {
              standbyBannerEnabled: true,
              standbyBannerShowBranch: false,
              standbyBannerShowPullRequest: false,
              notificationSoundEnabled: true,
            },
          },
        )
        await expect
          .poll(() => state(first.window))
          .toMatchObject({ state: 'idle', turn: null, lastEndedTurn: null })
        await expect(first.window.locator('.app-notification')).toHaveCount(0)
        expect(await sounds(first.window)).toEqual([])
      } finally {
        await first.electronApp.close()
      }

      const second = await launchApp(options)
      try {
        const terminal = second.window.locator('[data-id="history-agent"] .terminal-node')
        await expect(terminal).toContainText('STARTUP_HISTORY_READY')
        await expect
          .poll(() => state(second.window))
          .toMatchObject({ state: 'idle', turn: null, lastEndedTurn: null })
        await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
        await expect(second.window.locator('.app-notification')).toHaveCount(0)
        expect(await sounds(second.window)).toEqual([])
        await terminal.locator('.xterm-helper-textarea').click()
        await second.window.keyboard.type('live-turn')
        await second.window.keyboard.press('Enter')
        await expect(terminal).toContainText('LIVE_TURN_COMPLETED')
        await expect
          .poll(() => state(second.window))
          .toMatchObject({ state: 'idle', lastEndedTurn: { outcome: 'completed' } })
        await expect(second.window.locator('.app-notification')).toHaveCount(1)
        await expect.poll(() => sounds(second.window)).toHaveLength(1)
        const endedId = (await state(second.window))?.lastEndedTurn?.id
        await second.window.reload()
        await expect(terminal).toContainText('STARTUP_HISTORY_READY')
        await expect.poll(() => state(second.window)).toMatchObject({ state: 'idle', turn: null })
        const replayed = (await state(second.window))?.lastEndedTurn
        if (replayed) {
          expect(replayed.id).toBe(endedId)
        }
        await expect(second.window.locator('.app-notification')).toHaveCount(0)
        expect(await sounds(second.window)).toEqual([])
      } finally {
        await second.electronApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
}
