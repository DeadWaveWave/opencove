// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { waitForAgents } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'
import { completedPromptFixture } from './cliAgentPromptWait.helpers'
import { node } from './cliIdentity.helpers'

vi.mock('../../../src/app/cli/core/agentWait', () => ({ waitForAgents: vi.fn() }))

const warning =
  'The submitted text differed from what you sent; an existing draft may have been included. Do not resend; inspect the screen.'
const evidence = {
  textComparison: 'different',
  comparisonProfile: 'claude-code-v1',
  promptId: 'submitted-prompt',
}
const args = ['agent', 'prompt', '--node', node.id, '--text', 'Requested text']
function fixture() {
  const f = completedPromptFixture()
  f.values['agent.prompt'] = { ...(f.values['agent.prompt'] as object), ...evidence }
  let stderr = ''
  const write = f.io.stderr.write
  f.io.stderr.write = text => {
    stderr += text
    return write(text)
  }
  vi.mocked(waitForAgents).mockResolvedValue({
    nodeId: node.id,
    sessionId: 's',
    turnId: 't',
    outcome: 'completed',
    endedAt: 10,
    persisted: true,
    state: 'idle',
  })
  return { ...f, stderr: () => stderr }
}
afterEach(() => vi.resetAllMocks())

it.each([
  ['agent.wait_timeout', 124],
  ['agent.wait_attention', 10],
  ['cli.interrupted', 130],
] as const)(
  'warns before waiting and retains submission comparison after %s',
  async (code, exitCode) => {
    const f = fixture()
    let warnedBeforeWait = false
    const targets = [{ nodeId: node.id, blockedSummary: { kind: 'plan' } }]
    vi.mocked(waitForAgents).mockImplementation(async () => {
      warnedBeforeWait = f.stderr().includes(warning)
      throw new CliError(code, exitCode, 'Waiting stopped.', undefined, { targets })
    })
    expect(await run([...args, '--wait', '--fields', 'deliveryId'], f.io)).toBe(exitCode)
    expect(warnedBeforeWait).toBe(true)
    expect(f.stderr().split(warning)).toHaveLength(2)
    expect(f.out()).toBe('')
    expect(f.error()).toMatchObject({
      code,
      details: {
        deliveryId: 'd',
        nodeId: node.id,
        sessionId: 's',
        turnId: 't',
        ...evidence,
        targets,
      },
    })
    expect(f.requests.filter(r => r.id === 'agent.prompt')).toHaveLength(1)
  },
)
it('warns before confirmation and retains comparison when confirmation fails', async () => {
  const f = fixture()
  f.values['agent.delivery.get'] = { available: false, deliveryId: 'd', reason: 'unavailable' }
  const fetch = f.io.fetch
  let warnedBeforeConfirmation = false
  f.io.fetch = (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'agent.delivery.get') {
      warnedBeforeConfirmation = f.stderr().includes(warning)
    }
    return fetch(url, init)
  }
  expect(await run([...args, '--wait'], f.io)).toBe(1)
  expect(warnedBeforeConfirmation).toBe(true)
  expect(f.error()).toMatchObject({ details: { ...evidence, deliveryId: 'd', turnId: 't' } })
  expect(waitForAgents).not.toHaveBeenCalled()
})
it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])('prints one warning on success (TTY=%s, wait=%s)', async (tty, wait) => {
  const f = fixture()
  f.io.stderr.isTTY = tty
  expect(await run([...args, ...(wait ? ['--wait'] : []), '--fields', 'deliveryId'], f.io)).toBe(0)
  expect(f.stderr().split(warning)).toHaveLength(2)
  expect(JSON.parse(f.out())).toEqual({ deliveryId: 'd' })
})
it.each(['matched', 'unavailable'])(
  'does not warn for %s submission evidence',
  async textComparison => {
    const f = fixture()
    f.values['agent.prompt'] = { ...(f.values['agent.prompt'] as object), textComparison }
    expect(await run([...args, '--wait'], f.io)).toBe(0)
    expect(f.stderr()).not.toContain(warning)
  },
)
