import { expect, test } from '@playwright/test'
import { cli, launchRealClaude } from './agent.prompt.real-claude.helpers'

test('create agent returns the real Claude initial reply from the mock API', async ({
  browserName: _browserName,
}, testInfo) => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Claude CLI')
  test.skip(process.platform === 'win32', 'POSIX acceptance')
  test.setTimeout(180_000)
  const real = await launchRealClaude(testInfo)
  try {
    const result = await cli(real.userDataDir, [
      'node',
      'create',
      'agent',
      '--space',
      'real-prompt-main',
      '--provider',
      'claude-code',
      '--prompt',
      'Reply with ACK.',
      '--wait',
      '--read',
      '--timeout',
      '30s',
    ])
    expect(result.exitCode, JSON.stringify(result)).toBe(0)
    const value = JSON.parse(result.stdout)
    expect(value).toMatchObject({
      node: { id: expect.any(String), sessionId: expect.any(String) },
      turnId: expect.any(String),
      outcome: 'completed',
      reply: { message: 'ACK', source: 'hook' },
    })
    expect(value.reply).toMatchObject({
      nodeId: value.node.id,
      sessionId: value.node.sessionId,
      turnId: value.turnId,
    })
    expect(real.api.main()).toHaveLength(2)
    expect(real.api.main()[1]).toContain('Reply with ACK.')
  } finally {
    await real.close()
  }
})
