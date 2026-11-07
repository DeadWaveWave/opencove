import { normalizeClaudeHookEnvelope } from '../../src/app/main/controlSurface/agentHook/claudeHookProtocol'
// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opencove-strict-prompt-'))
  const relay = join(root, 'relay.mjs'),
    settings = join(root, 'settings.json')
  const record = join(root, 'record.jsonl'),
    hooks = join(root, 'hooks.jsonl'),
    dialog = join(root, 'dialog')
  await writeFile(
    relay,
    `import { appendFile } from 'node:fs/promises'; let text=''; for await (const chunk of process.stdin) text+=chunk; await appendFile(process.env.STRICT_HOOK_RECORD, text+'\\n')`,
  )
  await writeFile(
    settings,
    JSON.stringify({
      hooks: Object.fromEntries(
        ['UserPromptSubmit', 'Stop', 'PermissionRequest'].map(event => [
          event,
          [{ hooks: [{ command: process.execPath, args: [relay] }] }],
        ]),
      ),
    }),
  )
  const child = spawn(
    process.execPath,
    [
      resolve('scripts/test-agent-session-stub.mjs'),
      'claude-code',
      root,
      'new',
      'model',
      '',
      'claude-prompt-strict',
      '--settings',
      settings,
      '--session-id',
      'strict-id',
    ],
    {
      env: {
        ...process.env,
        STRICT_HOOK_RECORD: hooks,
        OPENCOVE_TEST_PROMPT_RECORD: record,
        OPENCOVE_TEST_PROMPT_DIALOG: dialog,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  let stdout = '',
    stderr = ''
  child.stdout.on('data', data => {
    stdout += data
  })
  child.stderr.on('data', data => {
    stderr += data
  })
  const exit = new Promise<number | null>((done, reject) => {
    child.once('exit', done)
    child.once('error', reject)
  })
  const read = async (path: string) => {
    try {
      return (await readFile(path, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    } catch {
      return []
    }
  }
  await vi.waitFor(() => expect(stdout, stderr).toContain('STRICT_READY'))
  return {
    child,
    root,
    record,
    hooks,
    dialog,
    read,
    exit,
    cleanup: async () => {
      try {
        const inputs = await read(hooks)
        for (const input of inputs) {
          expect(normalizeClaudeHookEnvelope(input), JSON.stringify(input)).not.toBeNull()
        }
      } finally {
        child.kill()
        await exit
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}
it('strict fixture distinguishes fragmented multiline paste from submit and emits hook boundaries only on Enter', async () => {
  const f = await fixture()
  try {
    f.child.stdin.write('\x1b[20')
    f.child.stdin.write('0~one\rtwo\rthree\x1b[201~')
    await vi.waitFor(async () =>
      expect(await f.read(f.record)).toEqual([{ kind: 'paste', text: 'one\rtwo\rthree' }]),
    )
    expect(await f.read(f.hooks)).toEqual([])
    f.child.stdin.write('\r')
    await vi.waitFor(async () =>
      expect((await f.read(f.hooks)).map(event => event.hook_event_name)).toEqual([
        'UserPromptSubmit',
        'Stop',
      ]),
    )
    expect((await f.read(f.record)).filter(event => event.kind === 'submit')).toHaveLength(1)
  } finally {
    await f.cleanup()
  }
})
it('strict dialog records zero received bytes and fails on any subsequent byte', async () => {
  const f = await fixture()
  try {
    await writeFile(f.dialog, 'permission')
    await vi.waitFor(async () =>
      expect(await f.read(f.record)).toEqual([{ kind: 'dialog', bytes: 0 }]),
    )
    expect((await f.read(f.hooks)).map(event => event.hook_event_name)).toEqual([
      'PermissionRequest',
    ])
    f.child.stdin.write('x')
    expect(await f.exit).toBe(1)
    expect(await f.read(f.record)).toContainEqual({ kind: 'dialog_bytes', bytes: 1 })
  } finally {
    await f.cleanup()
  }
})
