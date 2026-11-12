// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import {
  normalizeCodexHookEnvelope,
  validateCodexHookEnvelope,
} from '../../../src/app/main/controlSurface/agentHook/codexHookProtocol'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'

async function records(path: string) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
}
function output(child: ChildProcessWithoutNullStreams) {
  let text = '',
    error = ''
  child.stdout.on('data', chunk => {
    text += chunk
  })
  child.stderr.on('data', chunk => {
    error += chunk
  })
  return async (marker: string) => {
    await expect
      .poll(() => ({ found: text.includes(marker), error }), { timeout: 6000 })
      .toEqual({ found: true, error: '' })
  }
}

it.skipIf(process.platform === 'win32')(
  'strict Codex sends valid raw hook inputs through the generated stdin relay; notify argv stays notify',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-codex-prompt-'))
    const artifacts = new AgentLaunchArtifactScope()
    const captured = join(root, 'hooks.jsonl'),
      record = join(root, 'records.jsonl'),
      dialog = join(root, 'dialog')
    let child: ChildProcessWithoutNullStreams | undefined
    try {
      // Intercept only the relay's HTTP transport. The real generated script still selects stdin
      // vs argv, stamps at relay start, converts notify, and serializes the request.
      const preload = join(root, 'capture.mjs')
      await writeFile(
        preload,
        `import { appendFile } from 'node:fs/promises';
      globalThis.fetch = async (url, init) => {
        await appendFile(process.env.OPENCOVE_TEST_HOOK_CAPTURE, JSON.stringify({url, headers: init.headers, body: JSON.parse(init.body), receivedAt: Date.now()}) + '\\n');
        return { ok: true };
      };`,
      )
      const env = {
        ...process.env,
        CODEX_HOME: join(root, 'codex'),
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        OPENCOVE_TEST_HOOK_CAPTURE: captured,
        OPENCOVE_TEST_PROMPT_RECORD: record,
        OPENCOVE_TEST_PROMPT_DIALOG: dialog,
      }
      const provider = new CodexAgentProviderContribution({
        runtimePlatform: 'linux',
        runtimeExecutable: process.execPath,
        hookTrustResolver: async () => "hooks.state={'fixture'={trusted_hash='sha256:fixture'}}",
        channel: {
          async start() {},
          getInstallState: () => 'installed',
          reserveSpawn: async () => ({
            usesHook: true,
            installState: 'installed',
            env: {
              OPENCOVE_CODEX_HOOK_ENDPOINT: 'http://127.0.0.1:1234/hooks/codex',
              OPENCOVE_CODEX_HOOK_TOKEN: 'fixture-token',
            },
            commit() {},
            async dispose() {},
          }),
        } as unknown as AgentHookChannel,
      })
      const plan = await provider.hookInjection.prepareHookInjection({
        artifacts,
        environment: env,
        workspaceDirectory: root,
      })
      expect(plan.hookCoverage).toBe('lifecycle')
      child = spawn(
        process.execPath,
        [
          resolve('scripts/test-agent-session-stub.mjs'),
          'codex',
          root,
          'new',
          'fixture',
          '',
          'codex-prompt-strict',
          ...plan.args,
        ],
        { env: { ...env, ...plan.env } },
      )
      const waitFor = output(child)
      await waitFor('STRICT_READY')
      child.stdin.write('manual baseline\r')
      await waitFor('STRICT_TURN_1')
      child.stdin.write('\x1b[200~first\rsecond\rthird\x1b[201~')
      await expect
        .poll(async () => (await records(record)).filter(e => e.kind === 'paste').length)
        .toBe(1)
      expect((await records(record)).filter(e => e.kind === 'submit')).toHaveLength(1)
      const beforeEnter = Date.now()
      child.stdin.write('\r')
      await waitFor('STRICT_TURN_2')
      await writeFile(dialog, 'permission')
      await waitFor('STRICT_DIALOG')
      const hooks = await records(captured)
      expect(hooks.map(h => h.body.hook_event_name)).toEqual([
        'UserPromptSubmit',
        'Stop',
        'UserPromptSubmit',
        'Stop',
        'PermissionRequest',
      ])
      for (const hook of hooks) {
        expect(normalizeCodexHookEnvelope(hook.body)).toMatchObject({
          codexSessionId: 'strict-codex',
          hookEventName: hook.body.hook_event_name,
          state:
            hook.body.hook_event_name === 'Stop'
              ? 'done'
              : hook.body.hook_event_name === 'PermissionRequest'
                ? 'waiting'
                : 'working',
        })
        expect(hook.headers['x-opencove-hook-token']).toBe('fixture-token')
        expect(Number(hook.headers['x-opencove-hook-emitted-at'])).toBeLessThanOrEqual(
          hook.receivedAt,
        )
        expect(Number.isFinite(Number(hook.headers['x-opencove-hook-emitted-at']))).toBe(true)
      }
      expect(Number(hooks[2].headers['x-opencove-hook-emitted-at'])).toBeGreaterThanOrEqual(
        beforeEnter,
      )
      expect((await records(record)).filter(e => e.kind === 'submit')).toEqual([
        { kind: 'submit', text: 'manual baseline', turn: 1 },
        { kind: 'submit', text: 'first\rsecond\rthird', turn: 2 },
      ])
      const notifyConfig = plan.args.find(arg => arg.startsWith('notify='))!
      const [command, ...args] = JSON.parse(notifyConfig.slice('notify='.length)) as string[]
      const notify = spawn(
        command,
        [
          ...args,
          JSON.stringify({
            type: 'agent-turn-complete',
            'thread-id': 'strict-codex',
            'turn-id': 'T1',
          }),
        ],
        { env: { ...env, ...plan.env } },
      )
      notify.stdin.end()
      expect(await new Promise(resolveExit => notify.once('close', resolveExit))).toBe(0)
      const last = (await records(captured)).at(-1)!
      expect(validateCodexHookEnvelope(last.body)).toMatchObject({
        state: 'done',
        hookEventName: 'notify',
        providerTurnId: 'T1',
      })
      expect(normalizeCodexHookEnvelope(last.body)).toBeNull()
      expect(Number.isFinite(Number(last.headers['x-opencove-hook-emitted-at']))).toBe(true)
    } finally {
      if (child) {
        const closed = new Promise(resolveExit => child!.once('close', resolveExit))
        child.kill()
        await closed
      }
      artifacts.seal()
      await artifacts.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
  15000,
)
