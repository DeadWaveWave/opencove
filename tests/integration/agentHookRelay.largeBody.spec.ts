// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { createAgentHookRelay } from '../../src/contexts/agent/infrastructure/providers/shared/AgentHookRelay'
import { AgentLaunchArtifactScope } from '../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { getPromptSubmissionEvidence } from '../../src/shared/runtime/agentHook/claudePromptEvidence'
import {
  inMemoryClaudeHookChannel,
  inMemoryCodexHookChannel,
} from '../support/inMemoryClaudeHookChannel'

async function relay(input: string, provider: 'claude' | 'codex' = 'claude') {
  const root = await mkdtemp(join(tmpdir(), 'opencove-large-relay-'))
  const artifacts = new AgentLaunchArtifactScope()
  const capture = join(root, 'body'),
    preload = join(root, 'fetch.mjs')
  try {
    // Execute the actual generated stdin reader/compactor in a child. Replace only network IO,
    // since the sandbox denies listen(); the captured POST goes through the real channel below.
    await writeFile(
      preload,
      `import { writeFile } from 'node:fs/promises'; globalThis.fetch = async (_url, options) => { await writeFile(${JSON.stringify(capture)}, options.body); return new Response(null, {status:204}); };`,
    )
    const invocation = await createAgentHookRelay({
      provider,
      runtimeExecutable: process.execPath,
      runtimePlatform: process.platform,
      artifacts,
    })
    await new Promise<void>((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          [`OPENCOVE_${provider.toUpperCase()}_HOOK_ENDPOINT`]: 'http://relay.test',
          [`OPENCOVE_${provider.toUpperCase()}_HOOK_TOKEN`]: 'token',
        },
      })
      let stderr = ''
      child.stdout.resume()
      child.stderr.on('data', data => {
        stderr += data
      })
      child.stdin.on('error', () => {})
      child.once('error', reject)
      child.once('close', code =>
        code === 0 && !stderr ? resolve() : reject(new Error(`Relay ${code}: ${stderr}`)),
      )
      child.stdin.end(input)
    })
    return await readFile(capture, 'utf8').catch(() => null)
  } finally {
    await artifacts.dispose()
    await rm(root, { recursive: true, force: true })
  }
}
const payload = (fields = {}) => ({
  hook_event_name: 'Stop',
  session_id: 'provider',
  transcript_path: '/tmp/t',
  cwd: '/tmp',
  prompt_id: 'p',
  ...fields,
})
it.each([300 * 1024, 2 * 1024 * 1024])(
  'delivers lifecycle evidence and a marked prefix from a real relay with %i reply bytes',
  async size => {
    const body = await relay(
      JSON.stringify(payload({ last_assistant_message: '🙂'.repeat(size / 4) })),
    )
    expect(body).not.toBeNull()
    expect(Buffer.byteLength(body!)).toBeLessThanOrEqual(256 * 1024)
    const posted = JSON.parse(body!)
    expect(posted).toMatchObject({
      hook_event_name: 'Stop',
      prompt_id: 'p',
      last_assistant_message_truncated: true,
    })
    expect(posted.last_assistant_message).toBe('🙂'.repeat((16 * 1024) / 4))
    const { channel, post } = inMemoryClaudeHookChannel()
    try {
      const reservation = await channel.reserveSpawn()
      reservation.commit('s')
      let observed = false
      channel.onState(event => {
        observed = true
        expect(event.state).toBe('standby')
        expect(getPromptSubmissionEvidence(event)?.finalMessage).toEqual({
          message: posted.last_assistant_message,
          truncated: true,
        })
      })
      expect(
        await post(reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN!, 'Stop', undefined, posted),
      ).toBe(204)
      expect(observed).toBe(true)
    } finally {
      await channel.dispose()
    }
  },
)
it('budgets JSON escaping for both text fields and marks prompt evidence unusable', async () => {
  const body = await relay(
    JSON.stringify(
      payload({
        prompt: '\u0000'.repeat(300 * 1024),
        last_assistant_message: '\u0000'.repeat(300 * 1024),
      }),
    ),
  )
  expect(Buffer.byteLength(body!)).toBeLessThanOrEqual(256 * 1024)
  expect(JSON.parse(body!)).toMatchObject({
    prompt_truncated: true,
    last_assistant_message_truncated: true,
  })
})
it('keeps small posts verbatim and quietly drops hard-cap, malformed and unshrinkable input', async () => {
  const small = JSON.stringify(payload({ last_assistant_message: '' }))
  expect(await relay(small)).toBe(small)
  expect(
    await relay(JSON.stringify(payload({ last_assistant_message: 'x'.repeat(8 * 1024 * 1024) }))),
  ).toBeNull()
  expect(
    await relay(
      JSON.stringify(
        payload({
          unrelated: 'x'.repeat(300 * 1024),
          last_assistant_message: 'x'.repeat(300 * 1024),
        }),
      ),
    ),
  ).toBeNull()
  expect(await relay('{'.repeat(300 * 1024))).toBeNull()
})

it('cuts at code points and preserves malformed optional text for the normalizer to reject', async () => {
  const prefix = 'a'.repeat(16 * 1024 - 1)
  const body = await relay(
    JSON.stringify(payload({ last_assistant_message: prefix + '🙂'.repeat(100 * 1024) })),
  )
  expect(JSON.parse(body!).last_assistant_message).toBe(prefix)
  const malformed = await relay(
    JSON.stringify(payload({ last_assistant_message: '\ud800' + 'x'.repeat(300 * 1024) })),
  )
  expect(JSON.parse(malformed!).last_assistant_message.startsWith('\ud800')).toBe(true)
})

it.each([0, 1000])(
  'drops Codex notify conversion over the POST cap with %i raw padding bytes',
  async padding => {
    const input =
      JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'x'.repeat(262080) }) +
      ' '.repeat(padding)
    expect(await relay(input, 'codex')).toBeNull()
  },
)
it('delivers converted Codex notify at exactly the POST limit to the real receiver', async () => {
  const body = await relay(
    JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'x'.repeat(262071) }) +
      ' '.repeat(1000),
    'codex',
  )
  expect(body).not.toBeNull()
  expect(Buffer.byteLength(body!)).toBe(256 * 1024)
  const posted = JSON.parse(body!)
  expect(posted).toMatchObject({ version: 1, state: 'done', hookEventName: 'notify' })
  const { channel, post } = inMemoryCodexHookChannel()
  try {
    const reservation = await channel.reserveSpawn()
    reservation.commit('s')
    const states: unknown[] = []
    channel.onState(event => states.push(event.state))
    expect(
      await post(reservation.env!.OPENCOVE_CODEX_HOOK_TOKEN!, 'notify', undefined, posted),
    ).toBe(204)
    expect(states).toEqual(['standby'])
  } finally {
    await channel.dispose()
  }
})
it('preserves native Codex hook input and converts a small notify', async () => {
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'provider' })
  expect(await relay(input, 'codex')).toBe(input)
  expect(
    JSON.parse(
      (await relay(
        JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'provider' }),
        'codex',
      ))!,
    ),
  ).toEqual({
    version: 1,
    state: 'done',
    hookEventName: 'notify',
    codexSessionId: 'provider',
  })
})
