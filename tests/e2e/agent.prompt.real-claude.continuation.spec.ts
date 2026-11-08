import { expect, test } from '@playwright/test'
import { cli, launchRealClaude, prompt } from './agent.prompt.real-claude.helpers'

// Opt-in local acceptance with the installed Claude Code CLI, an isolated config and a local
// Messages API stand-in (no credentials, no model calls). Run with
// OPENCOVE_TEST_USE_REAL_AGENTS=1 pnpm exec playwright test tests/e2e/agent.prompt.real-claude*.spec.ts

test.describe('mid-turn messages with the real Claude Code CLI', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Claude CLI')
  test.skip(process.platform === 'win32', 'POSIX acceptance')

  test('keeps a message typed while Claude works in the current turn and survives compaction', async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(180_000)
    const real = await launchRealClaude(testInfo)
    const { window, api, userDataDir, sessionId, nodeId, snapshot } = real
    try {
      // A message typed while Claude works lands in the current OpenCove turn even when Claude
      // answers it in a follow-up provider turn: the turn stays working until that follow-up
      // ends, and its reply is the turn's reply.
      const slow = await prompt(userDataDir, nodeId, 'Please SLOW_TEXT now')
      expect(slow.exitCode, JSON.stringify(slow)).toBe(0)
      const slowTurn = JSON.parse(slow.stdout).turnId
      await window.waitForTimeout(2_000)
      await window.evaluate(async payload => await window.opencoveApi.pty.write(payload), {
        sessionId,
        data: '\x1b[200~Also say CHERRY\x1b[201~',
      })
      await window.waitForTimeout(300)
      await window.evaluate(async payload => await window.opencoveApi.pty.write(payload), {
        sessionId,
        data: '\r',
      })
      const states: string[] = []
      await expect
        .poll(
          async () => {
            const value = await snapshot()
            states.push(`${value.state}:${value.turn?.id ?? ''}:${value.lastEndedTurn?.id ?? ''}`)
            return value.lastEndedTurn?.id
          },
          { timeout: 40_000, intervals: [100] },
        )
        .toBe(slowTurn)
      expect(api.main().at(-1)?.join('\n')).toContain('Also say CHERRY')
      const beforeEnd = states.filter(entry => !entry.endsWith(`:${slowTurn}`))
      expect(beforeEnd.filter(entry => !entry.startsWith(`working:${slowTurn}:`))).toEqual([])
      const waitedSlow = await cli(userDataDir, [
        'agent',
        'wait',
        '--node',
        nodeId,
        '--turn',
        slowTurn,
      ])
      expect(waitedSlow.exitCode, JSON.stringify(waitedSlow)).toBe(0)
      expect(JSON.parse(waitedSlow.stdout)).toMatchObject({
        turnId: slowTurn,
        outcome: 'completed',
      })
      const readSlow = await cli(userDataDir, [
        'agent',
        'read',
        '--node',
        nodeId,
        '--turn',
        slowTurn,
      ])
      expect(readSlow.exitCode, JSON.stringify(readSlow)).toBe(0)
      expect(readSlow.stdout.trim()).toBe('ACK')

      // /compact starts a new SessionStart (source compact) for the same conversation; the
      // agent must stay promptable afterwards.
      await window.evaluate(async payload => await window.opencoveApi.pty.write(payload), {
        sessionId,
        data: '/compact',
      })
      await window.waitForTimeout(300)
      await window.evaluate(async payload => await window.opencoveApi.pty.write(payload), {
        sessionId,
        data: '\r',
      })
      await expect
        .poll(
          async () => {
            const value = await snapshot()
            return `${value.state}:${value.quality}`
          },
          { timeout: 30_000 },
        )
        .toBe('idle:authoritative')
      const afterCompact = await prompt(userDataDir, nodeId, 'After compaction')
      expect(afterCompact.exitCode, JSON.stringify(afterCompact)).toBe(0)
      await expect
        .poll(async () => (await snapshot()).lastEndedTurn?.id, { timeout: 30_000 })
        .toBe(JSON.parse(afterCompact.stdout).turnId)
    } finally {
      await real.close()
    }
  })
})
