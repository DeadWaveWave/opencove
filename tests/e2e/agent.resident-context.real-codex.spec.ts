import { expect, test } from '@playwright/test'
import { prompt } from './agent.prompt.real-codex.helpers'
import { launchResidentCodex } from './agent.resident-context.real-codex.helpers'
import {
  codexContext,
  clearConversation,
  expectResidentContext,
} from './agent.resident-context.helpers'

test.describe('Codex resident OpenCove context', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Codex CLI')
  test.skip(process.platform === 'win32', 'Codex lifecycle hooks are not used on Windows')
  for (const mode of ['suggest', 'off'] as const) {
    test(`${mode}: startup and clear preserve the context policy`, async ({
      browserName: _browserName,
    }, testInfo) => {
      test.setTimeout(150_000)
      const real = await launchResidentCodex(testInfo, mode)
      try {
        const first = real.api.requests()[0]
        expectResidentContext(
          mode === 'suggest' ? codexContext(first) : JSON.stringify(first),
          mode === 'suggest',
        )
        const count = real.api.requests().length
        await clearConversation(real.page, real.sessionId)
        const sent = await prompt(real.userDataDir, real.nodeId, 'AFTER_CLEAR reply with ACK.')
        expect(sent.exitCode, JSON.stringify(sent)).toBe(0)
        await expect
          .poll(() => real.api.requests().length, { timeout: 30_000 })
          .toBeGreaterThan(count)
        const body = real.api.requests().at(-1)!
        expectResidentContext(
          mode === 'suggest' ? codexContext(body) : JSON.stringify(body),
          mode === 'suggest',
        )
        expect(JSON.stringify(body.input)).not.toContain('Reply with ACK.')
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
