// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { createAgentHookRelay } from '../../src/contexts/agent/infrastructure/providers/shared/AgentHookRelay'
import { AgentLaunchArtifactScope } from '../../src/contexts/agent/application/services/AgentLaunchArtifactScope'

it('generated relay stamps producer time before reading stdin and sends it as a header', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-relay-provenance-')),
    artifacts = new AgentLaunchArtifactScope()
  const preload = join(root, 'capture.mjs')
  await writeFile(
    preload,
    `let clock = 1000; Date.now = () => clock;
const iterator = process.stdin[Symbol.asyncIterator].bind(process.stdin);
process.stdin[Symbol.asyncIterator] = function () { clock = 2000; process.stdout.write(JSON.stringify({ readingAt: Date.now() })+'\\n'); return iterator() };
globalThis.fetch = async (_url, options) => { process.stdout.write(JSON.stringify({ headers: options.headers, body: options.body, sentAt: Date.now() })+'\\n'); return { ok: true } };`,
  )
  const relay = await createAgentHookRelay({
    provider: 'claude',
    runtimeExecutable: process.execPath,
    runtimePlatform: process.platform,
    artifacts,
  })
  const child = spawn(relay.command, relay.args, {
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      OPENCOVE_CLAUDE_HOOK_ENDPOINT: 'http://unused',
      OPENCOVE_CLAUDE_HOOK_TOKEN: 'test',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = '',
    errors = ''
  const ready = new Promise<void>(resolve =>
    child.stdout.on('data', chunk => {
      output += chunk
      if (output.includes('readingAt')) {
        resolve()
      }
    }),
  )
  child.stderr.on('data', chunk => {
    errors += chunk
  })
  const exit = new Promise((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  })
  try {
    await ready
    const payload = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      transcript_path: '/tmp/test',
      cwd: root,
      session_id: 's',
    })
    child.stdin.end(payload)
    expect(await exit, errors).toBe(0)
    const [reading, sent] = output
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    const emitted = Number(sent.headers['x-opencove-hook-emitted-at'])
    expect(emitted).toBe(1000)
    expect(reading.readingAt).toBe(2000)
    expect(emitted).toBeLessThanOrEqual(reading.readingAt)
    expect(emitted).toBeLessThanOrEqual(sent.sentAt)
    expect(sent.body).toBe(payload)
  } finally {
    child.kill()
    await artifacts.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
