import { expect, test } from '@playwright/test'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchRealClaude, prompt } from './agent.prompt.real-claude.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'
import { selectCoveOption } from './workspace-canvas.helpers'

const blockedSummary = {
  kind: 'question',
  questions: [{ question: 'Which option should the probe use?', options: ['First', 'Second'] }],
}

test.describe('Claude waiting reason and dialog summary', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Claude CLI')
  test.skip(process.platform === 'win32', 'POSIX real Claude fixture')

  test('exposes the real question through CLI get/list and exit-10 details without treating it as an instruction', async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(180_000)
    // Uses an isolated CLAUDE_CONFIG_DIR and the existing local Messages API fixture.
    const real = await launchRealClaude(testInfo)
    const { window: page, nodeId, userDataDir, sessionId, snapshot } = real
    try {
      const parent = await page.evaluate(async () =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceName', name: 'Main', projectId: 'real-prompt' },
            title: 'Waiting inspector',
            frame: { x: 700, y: 80, width: 760, height: 540 },
            data: { shell: '/bin/sh' },
          },
        }),
      )
      expect(parent.node.sessionId).toBeTruthy()
      const binding = { nodeId: parent.node.id, sessionId: parent.node.sessionId! }
      await expect(
        page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
      ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
      const delivered = await prompt(userDataDir, nodeId, 'TRIGGER_TOOL run the probe')
      expect(delivered.exitCode, JSON.stringify(delivered)).toBe(0)
      const turnId = JSON.parse(delivered.stdout).turnId as string
      await expect
        .poll(async () => (await snapshot()).blockedSummary, { timeout: 30_000 })
        .toEqual(blockedSummary)
      // Delayed notifications must not erase question data. The dialog remains unanswered.
      const get = async () =>
        jsonOutput(
          await terminalCommand(
            page,
            binding,
            `opencove agent get --node ${nodeId} --fields nodeId,sessionId,state,blockedReason,blockedSummary -o json`,
            'GET',
          ),
        )
      const initial = await get()
      // Claude also sends PermissionRequest for AskUserQuestion; the user still sees a question.
      expect(initial).toMatchObject({
        nodeId,
        sessionId,
        state: 'waiting',
        blockedReason: 'question',
        blockedSummary,
      })
      const listed = jsonOutput(
        await terminalCommand(
          page,
          binding,
          `opencove agent list --state waiting --fields nodeId,blockedSummary -o json`,
          'LIST',
        ),
      )
      expect(listed.agents).toEqual(expect.arrayContaining([{ nodeId, blockedSummary }]))
      const output = await terminalCommand(
        page,
        binding,
        `opencove agent wait --node ${nodeId} --turn ${turnId} --timeout 30s -o json`,
        'WAIT',
      )
      expect(output).toMatch(/\bexit=10\b/)
      const error = JSON.parse(
        output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1).replaceAll('\n', ''),
      ).error
      expect(error).toMatchObject({
        code: 'agent.wait_attention',
        details: {
          targets: [expect.objectContaining({ nodeId, sessionId, turnId, blockedSummary })],
        },
      })
      expect(error.message).toBe(
        `Waiting observed for ${nodeId}; the agent may need the user — inspect before acting.`,
      )
      expect(error.message + error.hint).not.toContain(blockedSummary.questions[0].question)
      // Do not answer the question; inspect both themes while it is genuinely blocked.
      const captureTheme = async (theme: 'light' | 'dark') => {
        await page.getByTestId('app-header-settings').click()
        await page.getByTestId('settings-section-nav-appearance').click()
        await selectCoveOption(page, 'settings-ui-theme', theme)
        await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', theme)
        await page.locator('.settings-panel__close').click()
        const current = await get()
        expect(current).toMatchObject({
          state: 'waiting',
          blockedReason: 'question',
          blockedSummary,
        })
        const sidebar = page.locator('.workspace-sidebar .workspace-agent-item__status-label')
        await expect(sidebar).toContainText('Has a question')
        await testInfo.attach(`question-attention-${theme}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
      }
      await captureTheme('light')
      await captureTheme('dark')
    } finally {
      await real.close()
    }
  })
})
