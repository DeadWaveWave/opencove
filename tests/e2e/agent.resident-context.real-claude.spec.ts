import { expect, test } from '@playwright/test'
import { launchRealClaude } from './agent.prompt.real-claude.helpers'
import {
  claudeContext,
  clearConversation,
  expectResidentContext,
} from './agent.resident-context.helpers'

test.describe('Claude resident OpenCove context', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Claude CLI')
  test.skip(process.platform === 'win32', 'POSIX acceptance')
  for (const mode of ['suggest', 'off'] as const) {
    test(`${mode}: startup and clear preserve the context policy`, async ({
      browserName: _browserName,
    }, testInfo) => {
      test.setTimeout(150_000)
      const real = await launchRealClaude(testInfo, mode)
      try {
        expectResidentContext(claudeContext(real.api.requests()[0]), mode === 'suggest')
        const count = real.api.requests().length
        await clearConversation(real.window, real.sessionId)
        // Main clears readiness on /clear; a real user can start the next turn in the TUI.
        await real.window
          .locator(`.react-flow__node[data-id="${real.nodeId}"] .xterm-helper-textarea`)
          .click()
        await real.window.keyboard.type('AFTER_CLEAR reply with ACK.', { delay: 30 })
        await real.window.keyboard.press('Enter')
        await expect
          .poll(() => real.api.requests().length, { timeout: 30_000 })
          .toBeGreaterThan(count)
        const body = real.api.requests()[count]
        expect(claudeContext(body)).toContain('AFTER_CLEAR reply with ACK.')
        expectResidentContext(claudeContext(body), mode === 'suggest')
        // A new provider conversation must drop its original user prompt.
        expect(claudeContext(body)).not.toContain('Reply with ACK.')
        await testInfo.attach('role-aware-main-requests', {
          body: JSON.stringify(real.api.requests(), null, 2),
          contentType: 'application/json',
        })
      } finally {
        await real.close()
      }
    })
  }
})
