// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { createAgentHookRelay } from '../../src/contexts/agent/infrastructure/providers/shared/AgentHookRelay'
import { AgentLaunchArtifactScope } from '../../src/contexts/agent/application/services/AgentLaunchArtifactScope'

// Built from parts so the secret scanner does not read a test fixture as a credential.
function endpointWithCredentials(provider: string): string {
  const url = new URL(`http://127.0.0.1:1234/hooks/${provider}`)
  url.username = 'user'
  url.password = 'pass'
  return url.href
}

const context = 'OpenCove 中文 "context"\nRun `opencove whoami`.'
const output =
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  }) + '\n'
const cases = [
  'valid',
  '204',
  'non-2xx',
  'redirect',
  'wrong-content-type',
  'wrong-version',
  'wrong-type',
  'oversize-text',
  'oversize-body',
  'invalid-utf8',
  'invalid-json',
  'slow-body',
  'timeout',
  'epipe',
  'wrong-event',
  'bad-endpoint',
  'endpoint-query',
  'endpoint-credentials',
  'endpoint-path',
  'endpoint-fragment',
  'stuck-stdout',
] as const

it.each(
  (['claude', 'codex'] as const).flatMap(provider => cases.map(mode => [provider, mode] as const)),
)(
  'generated %s relay handles %s with bounded SessionStart output',
  async (provider, mode) => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-relay-context-'))
    const artifacts = new AgentLaunchArtifactScope()
    const relay = await createAgentHookRelay({
      provider,
      runtimeExecutable: process.execPath,
      runtimePlatform: process.platform,
      artifacts,
    })
    const preload = join(root, 'response.mjs')
    await writeFile(
      preload,
      `
import { Readable } from 'node:stream';
import { writeFileSync } from 'node:fs';
const mode = process.env.REPLY_CASE;
if (mode === 'stuck-stdout') process.stdout.write = () => false;
if (mode === 'epipe') process.stdout.write = (_data, done) => { const e = Object.assign(new Error('closed'), {code:'EPIPE'}); queueMicrotask(() => {process.stdout.emit('error', e); done?.(e)}); return false };
globalThis.fetch = async (_url, options) => {
  const started = performance.now();
  if (options.redirect !== 'error') throw new Error('Redirects must be rejected');
  options.signal.addEventListener('abort', () => writeFileSync(${JSON.stringify(join(root, 'timing.json'))}, JSON.stringify({mode, elapsedMs: performance.now() - started})), {once:true});
  if (mode === 'timeout') await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
  let bytes = Buffer.from(JSON.stringify({v: mode === 'wrong-version' ? 2 : 1, context: mode === 'oversize-text' ? '中'.repeat(700) : mode === 'wrong-type' ? {} : ${JSON.stringify(context)}}));
  if (mode === 'invalid-utf8') bytes = Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([0xff, 0x7d])]);
  if (mode === 'invalid-json') bytes = Buffer.from('{');
  const body = Readable.toWeb(Readable.from((async function* () {
    if (mode === 'oversize-body') { for (let i=0;i<20;i++) yield Buffer.alloc(1024, 32); return; }
    if (mode === 'slow-body') { for (const byte of bytes) { await new Promise(r => setTimeout(r, 20)); yield Buffer.from([byte]); } return; }
    yield bytes;
  })()));
  const response = new Response(mode === '204' ? null : body, {status: mode === '204' ? 204 : mode === 'non-2xx' ? 500 : mode === 'redirect' ? 302 : 200, headers:{'content-type': mode === 'wrong-content-type' ? 'text/plain' : 'application/json'}});
  options.signal.addEventListener('abort', () => body.cancel().catch(() => {}), {once:true});
  return response;
};
`,
    )
    try {
      const started = performance.now()
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(relay.command, relay.args, {
            env: {
              ...process.env,
              NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
              REPLY_CASE: mode,
              [`OPENCOVE_${provider.toUpperCase()}_HOOK_ENDPOINT`]:
                mode === 'endpoint-query'
                  ? `http://127.0.0.1:1234/hooks/${provider}?q=1`
                  : mode === 'endpoint-credentials'
                    ? endpointWithCredentials(provider)
                    : mode === 'endpoint-path'
                      ? 'http://127.0.0.1:1234/wrong'
                      : mode === 'endpoint-fragment'
                        ? `http://127.0.0.1:1234/hooks/${provider}#x`
                        : mode === 'bad-endpoint'
                          ? 'http://example.com/hooks/' + provider
                          : 'http://127.0.0.1:1234/hooks/' + provider,
              [`OPENCOVE_${provider.toUpperCase()}_HOOK_TOKEN`]: 'test',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          let stdout = '',
            stderr = ''
          child.stdout.on('data', data => {
            stdout += data
          })
          child.stderr.on('data', data => {
            stderr += data
          })
          child.once('error', reject)
          child.once('close', code => resolve({ code, stdout, stderr }))
          child.stdin.end(
            JSON.stringify({
              hook_event_name: mode === 'wrong-event' ? 'Stop' : 'SessionStart',
              session_id: 's',
              cwd: '/tmp',
            }),
          )
        },
      )
      expect(result, mode).toEqual({
        code: 0,
        stdout: mode === 'valid' ? output : '',
        stderr: '',
      })
      if (['valid', 'slow-body', 'timeout'].includes(mode)) {
        process.stdout.write(`${provider} ${await readFile(join(root, 'timing.json'), 'utf8')}\n`)
      }
      if (mode === 'slow-body' || mode === 'timeout') {
        expect(performance.now() - started, mode).toBeLessThan(1200)
      }
    } finally {
      await artifacts.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
  20_000,
)
