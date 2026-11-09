import { expect, test } from '@playwright/test'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { cli, launchRealClaude, prompt } from './agent.prompt.real-claude.helpers'
import { terminalCommand } from './cli-terminal.helpers'

test.describe('parent CLI attention for a real Claude child', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Claude CLI')
  test.skip(process.platform === 'win32', 'POSIX acceptance')

  test('reports a child question to the parent, resumes the same turn after a TUI answer, and retains PTY exit', async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(180_000)
    const real = await launchRealClaude(testInfo)
    const { window: page, nodeId, sessionId, userDataDir, snapshot } = real
    try {
      const parent = await page.evaluate(async () =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceName', name: 'Main', projectId: 'real-prompt' },
            title: 'Parent coordinator',
            frame: { x: 700, y: 80, width: 760, height: 540 },
            data: { shell: '/bin/sh' },
          },
        }),
      )
      expect(parent.node.sessionId).toBeTruthy()
      const binding = { nodeId: parent.node.id, sessionId: parent.node.sessionId! }
      const parentTerminal = page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`)
      await expect(parentTerminal).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })

      const delivered = await prompt(userDataDir, nodeId, 'TRIGGER_TOOL run the probe')
      expect(delivered.exitCode, JSON.stringify(delivered)).toBe(0)
      const turnId = JSON.parse(delivered.stdout).turnId as string
      await expect.poll(async () => (await snapshot()).state, { timeout: 30_000 }).toBe('waiting')
      // Claude reports the dialog through more than one hook, so the reason can move from
      // question to permission while the same turn stays blocked.
      const blocked = await snapshot()
      expect(blocked).toMatchObject({ turn: { id: turnId } })
      expect(['question', 'permission']).toContain(blocked.blockedReason)
      const command = `opencove agent wait --node ${nodeId} --turn ${turnId} --timeout 30s -o json`
      const start = Date.now()
      const attention = await terminalCommand(page, binding, command, 'ATTENTION')
      expect(attention).toMatch(/\bexit=10\b/)
      expect(Date.now() - start).toBeLessThan(10_000)
      expect(attention).toContain('agent.wait_attention')
      expect(attention).toContain('may need the user')
      expect(attention).toContain(sessionId)
      expect(attention).toContain(turnId)
      // Parent reports the wait to the user; only this explicit test action answers the child.
      const child = page.locator(`[data-id="${nodeId}"]`)
      // xterm paints to a canvas, so read the screen through the product CLI instead of the DOM.
      const screen = async () => {
        const read = await cli(userDataDir, ['agent', 'read', '--node', nodeId, '--screen'])
        return read.exitCode === 0 ? read.stdout.replace(/\s+/g, ' ') : ''
      }
      await expect.poll(screen, { timeout: 30_000 }).toContain('Which option should the probe use?')
      await expect.poll(screen, { timeout: 30_000 }).toContain('First')
      const editor = child.locator('.xterm-helper-textarea')
      await editor.focus()
      await testInfo.attach('child-question', {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await page.keyboard.press('Enter') // select the default First option
      // Wait for completion or an explicit review/submit screen before sending another key.
      let answerStage = ''
      await expect
        .poll(
          async () => {
            answerStage =
              (await snapshot()).state !== 'waiting'
                ? 'answered'
                : /Review your answers|Submit answers|Ready to submit|Enter to submit/i.test(
                      await screen(),
                    )
                  ? 'submit'
                  : 'choosing'
            return answerStage
          },
          { timeout: 15_000 },
        )
        .not.toBe('choosing')
      if (answerStage === 'submit') {
        await editor.focus()
        await page.keyboard.press('Enter')
      }
      await expect
        .poll(async () => (await snapshot()).lastEndedTurn?.id, { timeout: 30_000 })
        .toBe(turnId)
      const completed = await terminalCommand(page, binding, command, 'RESUMED')
      expect(completed).toMatch(/\bexit=0\b/)
      expect(
        JSON.parse(
          completed
            .slice(completed.indexOf('{'), completed.lastIndexOf('}') + 1)
            .replaceAll('\n', ''),
        ),
      ).toMatchObject({ nodeId, sessionId, turnId, outcome: 'completed' })

      const second = await prompt(userDataDir, nodeId, 'TRIGGER_TOOL run a second probe')
      expect(second.exitCode, JSON.stringify(second)).toBe(0)
      const secondTurn = JSON.parse(second.stdout).turnId as string
      await expect.poll(async () => (await snapshot()).state, { timeout: 30_000 }).toBe('waiting')
      await expect.poll(screen, { timeout: 30_000 }).toContain('Which option should the probe use?')
      const secondBlocked = await snapshot()
      expect(secondBlocked).toMatchObject({ turn: { id: secondTurn } })
      expect(['question', 'permission']).toContain(secondBlocked.blockedReason)
      // Kill only this test's own Claude PTY through the app lifecycle boundary.
      await page.evaluate(async id => window.opencoveApi.pty.kill({ sessionId: id }), sessionId)
      // Until the exit is observed the turn is still blocked, and wait would correctly exit 10.
      await expect
        .poll(async () => (await snapshot()).lastEndedTurn?.id, { timeout: 30_000 })
        .toBe(secondTurn)
      const killed = await cli(userDataDir, [
        'agent',
        'wait',
        '--node',
        nodeId,
        '--turn',
        secondTurn,
        '-o',
        'json',
      ])
      expect(killed.exitCode, JSON.stringify(killed)).toBe(0)
      expect(JSON.parse(killed.stdout)).toMatchObject({ turnId: secondTurn, outcome: 'unknown' })
    } finally {
      await real.close()
    }
  })
})
