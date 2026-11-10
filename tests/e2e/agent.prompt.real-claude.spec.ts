import { expect, test } from '@playwright/test'
import { cli, launchRealClaude, prompt } from './agent.prompt.real-claude.helpers'

// Opt-in local acceptance with the installed Claude Code CLI, an isolated config and a local
// Messages API stand-in (no credentials, no model calls). Run with
// OPENCOVE_TEST_USE_REAL_AGENTS=1 pnpm exec playwright test tests/e2e/agent.prompt.real-claude*.spec.ts

test.describe('agent.prompt with the real Claude Code CLI', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Claude CLI')
  test.skip(process.platform === 'win32', 'POSIX acceptance')

  test('submits one multi-line message and refuses an open question dialog', async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(180_000)
    const real = await launchRealClaude(testInfo)
    const { window, api, userDataDir, sessionId, nodeId, snapshot } = real
    try {
      const text = 'Line one of the prompt\nLine two of the prompt\nLine three of the prompt'
      const delivered = await cli(userDataDir, [
        'agent',
        'prompt',
        '--node',
        nodeId,
        '--wait',
        '--read',
        '--timeout',
        '30s',
        '--text',
        text,
      ])
      expect(delivered.exitCode, JSON.stringify(delivered)).toBe(0)
      expect(JSON.parse(delivered.stdout)).toMatchObject({
        phase: 'submission_observed',
        textComparison: 'matched',
        comparisonProfile: 'claude-code-v1',
      })
      expect(JSON.parse(delivered.stdout)).toMatchObject({
        outcome: 'completed',
        reply: { message: 'ACK', turnId: JSON.parse(delivered.stdout).turnId },
      })
      await expect.poll(() => api.main().length, { timeout: 30_000 }).toBe(2)
      // One submission whose user message carries the three lines as one exact text block.
      expect(api.main()[1]).toContain(text)
      // Wait for exactly the turn this prompt started, as an orchestrating agent would.
      const turnId = JSON.parse(delivered.stdout).turnId
      const waited = await cli(userDataDir, [
        'agent',
        'wait',
        '--node',
        nodeId,
        '--turn',
        turnId,
        '--timeout',
        '30s',
      ])
      expect(waited.exitCode, JSON.stringify(waited)).toBe(0)
      expect(JSON.parse(waited.stdout)).toMatchObject({ nodeId, turnId, outcome: 'completed' })
      expect((await snapshot()).lastEndedTurn).toMatchObject({ id: turnId, outcome: 'completed' })
      // The transcript lives under CLAUDE_CONFIG_DIR, not ~/.claude: the final message must still be found.
      const final = await window.evaluate(
        id =>
          window.opencoveApi.controlSurface.invoke<{ message: string | null }>({
            kind: 'query',
            id: 'session.finalMessage',
            payload: { nodeId: id },
          }),
        nodeId,
      )
      expect(final.message).toBe('ACK')

      // The reply comes from the Stop hook of exactly that turn, not from a transcript file.
      const readTurn = await cli(userDataDir, [
        'agent',
        'read',
        '--node',
        nodeId,
        '--turn',
        JSON.parse(delivered.stdout).turnId,
      ])
      expect(readTurn.exitCode, JSON.stringify(readTurn)).toBe(0)
      expect(readTurn.stdout.trim()).toBe('ACK')

      // A 300 KB reply still ends the turn (the Stop hook must not be dropped) and reads truncated.
      const long = await prompt(userDataDir, nodeId, 'LONG_REPLY please')
      expect(long.exitCode, JSON.stringify(long)).toBe(0)
      const waitedLong = await cli(userDataDir, [
        'agent',
        'wait',
        '--node',
        nodeId,
        '--turn',
        JSON.parse(long.stdout).turnId,
        '--timeout',
        '30s',
      ])
      expect(waitedLong.exitCode, JSON.stringify(waitedLong)).toBe(0)
      // The first turn is no longer the latest, but waiting for it still answers from history.
      const waitedEarlier = await cli(userDataDir, [
        'agent',
        'wait',
        '--node',
        nodeId,
        '--turn',
        turnId,
      ])
      expect(waitedEarlier.exitCode, JSON.stringify(waitedEarlier)).toBe(0)
      expect(JSON.parse(waitedEarlier.stdout)).toMatchObject({ turnId, outcome: 'completed' })
      // State waits share the same ordered stream; an agent that already settled counts at once.
      const settled = await cli(userDataDir, ['agent', 'wait', '--node', nodeId, '--until', 'idle'])
      expect(settled.exitCode, JSON.stringify(settled)).toBe(0)
      expect(JSON.parse(settled.stdout).agents[0]).toMatchObject({ nodeId, state: 'idle' })
      const readLong = await cli(userDataDir, [
        'agent',
        'read',
        '--node',
        nodeId,
        '--turn',
        JSON.parse(long.stdout).turnId,
        '-o',
        'json',
      ])
      expect(readLong.exitCode, JSON.stringify(readLong).slice(0, 400)).toBe(0)
      const longResult = JSON.parse(readLong.stdout)
      expect(longResult.truncated).toBe(true)
      expect(longResult.message.startsWith('LLLL')).toBe(true)
      expect(longResult.message.length).toBeLessThan(300_000)

      // A draft someone left in the editor is submitted together with the prompt: the
      // submission is still observed, but its text is reported as different.
      await window.evaluate(async payload => await window.opencoveApi.pty.write(payload), {
        sessionId,
        data: 'leftover draft ',
      })
      await window.waitForTimeout(500)
      const turnsBeforeDraft = api.main().length
      const withDraft = await prompt(userDataDir, nodeId, 'Second instruction')
      expect(withDraft.exitCode, JSON.stringify(withDraft)).toBe(0)
      expect(JSON.parse(withDraft.stdout)).toMatchObject({
        phase: 'submission_observed',
        textComparison: 'different',
      })
      expect(withDraft.stderr).toContain('Do not resend')
      await expect.poll(() => api.main().length, { timeout: 30_000 }).toBe(turnsBeforeDraft + 1)
      expect(api.main().at(-1)!.join('\n')).toContain('leftover draft Second instruction')
      await expect.poll(async () => (await snapshot()).state, { timeout: 30_000 }).toBe('idle')

      const tool = await cli(userDataDir, [
        'agent',
        'prompt',
        '--node',
        nodeId,
        '--wait',
        '--read',
        '--timeout',
        '30s',
        '--text',
        'TRIGGER_TOOL run the probe',
      ])
      expect(tool.exitCode, JSON.stringify(tool)).toBe(10)
      expect(tool.stdout).toBe('')
      const attention = JSON.parse(tool.stderr.trim().split('\n').at(-1)!).error
      expect(attention).toMatchObject({
        code: 'agent.wait_attention',
        details: {
          deliveryId: expect.any(String),
          turnId: expect.any(String),
          targets: [expect.objectContaining({ nodeId, sessionId, status: 'waiting' })],
        },
      })
      expect(attention.details.targets[0].turnId).toBe(attention.details.turnId)
      await expect
        .poll(
          // Any waiting state refuses, whatever blockedReason the hook could report.
          async () => (await snapshot()).state,
          { timeout: 30_000 },
        )
        .toBe('waiting')
      const turnsBefore = api.main().length
      const refused = await prompt(userDataDir, nodeId, 'MUST_NOT_ARRIVE')
      expect(refused.exitCode, JSON.stringify(refused)).toBe(1)
      expect(refused.stdout).toBe('')
      expect(refused.stderr).toContain('agent.blocked')
      await window.waitForTimeout(2_000)
      expect(api.main()).toHaveLength(turnsBefore)
      const screen = await window
        .locator('.terminal-node')
        .filter({ has: window.locator('.terminal-node__status') })
        .first()
        .innerText()
      expect(screen).not.toContain('MUST_NOT_ARRIVE')
      await testInfo.attach('question-dialog', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await real.close()
    }
  })
})
