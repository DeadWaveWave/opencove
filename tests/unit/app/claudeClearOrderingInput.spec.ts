// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

it('counts one bracketed paste and one Enter across separate stdin chunks and fences clear during paste', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-clear-input-'))
  const log = join(root, 'events'),
    hooks = join(root, 'hooks'),
    preload = join(root, 'fetch.mjs')
  await writeFile(
    preload,
    `import { appendFileSync } from 'node:fs'; globalThis.fetch = async (_url, options) => { appendFileSync(process.env.INPUT_HOOK_LOG, options.body + '\\n'); return { ok: true } }`,
  )
  const child = spawn(
    process.execPath,
    [
      '--import',
      preload,
      resolve('tests/e2e/fixtures/claude-clear-ordering.mjs'),
      'claude-code',
      root,
      'new',
      '',
      'A',
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CLAUDE_CONFIG_DIR: root,
        OPENCOVE_TEST_CLEAR_LOG: log,
        INPUT_HOOK_LOG: hooks,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })
  child.stdout.resume()
  const records = async () =>
    (await readFile(log, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map(
        line =>
          JSON.parse(line) as {
            scenario?: string
            pastes?: number
            enters?: number
            text?: string
          },
      )
  const wait = (scenario: string) =>
    vi.waitFor(async () =>
      expect(
        (await records()).some(r => r.scenario === scenario),
        stderr,
      ).toBe(true),
    )
  try {
    await vi.waitFor(async () => expect((await records()).length, stderr).toBe(1))
    child.stdin.write('clear-input\r')
    await wait('clear-input')
    child.stdin.write('\x1b[200~FIRST_B_INPUT\x1b[201~')
    // No line boundary: this must not submit.
    expect((await records()).some(r => r.scenario === 'submitted-input')).toBe(false)
    child.stdin.write('\r')
    await wait('submitted-input')
    expect((await records()).find(r => r.scenario === 'submitted-input')).toMatchObject({
      text: 'FIRST_B_INPUT',
      pastes: 1,
      enters: 1,
    })
    child.stdin.write('clear-after-paste\r')
    await wait('clear-after-paste')
    child.stdin.write('\x1b[200~CANCEL\x1b[201~')
    await wait('cleared-after-paste')
    expect((await records()).find(r => r.scenario === 'cleared-after-paste')).toMatchObject({
      pastes: 2,
      enters: 1,
    })
    const observed = (await readFile(hooks, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { hook_event_name: string; prompt?: string })
    expect(observed.filter(h => h.hook_event_name === 'UserPromptSubmit')).toEqual([
      expect.objectContaining({ prompt: 'FIRST_B_INPUT' }),
    ])
    // A refusal must also detect Enter without a preceding paste. Queries are serial barriers.
    child.stdin.write('\rinput-counts\rinput-counts\r')
    await vi.waitFor(async () =>
      expect((await records()).filter(r => r.scenario === 'input-counts')).toHaveLength(2),
    )
    expect((await records()).filter(r => r.scenario === 'input-counts')).toEqual([
      expect.objectContaining({ pastes: 2, enters: 2 }),
      expect.objectContaining({ pastes: 2, enters: 2 }),
    ])
  } finally {
    const exited = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()))
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await exited
    }
    await rm(root, { recursive: true, force: true })
  }
})
