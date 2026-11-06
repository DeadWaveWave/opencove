// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import { legacyGroups, legacyHelp } from '../../../src/app/cli/core/helpCatalog'

function fixture(tty = false) {
  let stdout = '',
    stderr = ''
  const io: CliIo = {
    stdout: {
      write: s => {
        stdout += s
      },
    },
    stderr: {
      isTTY: tty,
      write: s => {
        stderr += s
      },
    },
    env: {},
    now: Date.now,
    fetch: vi.fn(),
    readTextFile: vi.fn(async () => {
      throw Error('ENOENT')
    }),
    readStdinText: vi.fn(async () => ''),
    profileCandidates: () => ['.codex-out/tmp/profile-a', '.codex-out/tmp/profile-b'],
    legacy: vi.fn(async () => 0),
  }
  return { io, out: () => stdout, err: () => stderr }
}
it.each(legacyGroups)('lists real %s subcommands offline', async group => {
  const f = fixture()
  expect(await run([group, '--help'], f.io)).toBe(0)
  for (const [syntax, summary] of legacyHelp[group]) {
    expect(f.out()).toContain(syntax)
    expect(f.out()).toContain(summary)
  }
  expect(f.out()).toMatchSnapshot()
  expect(f.out()).not.toContain('(legacy)')
  expect(f.out()).not.toContain('--timeout')
  expect(f.out()).toContain('Global options: see "opencove --help".')
  expect(f.io.legacy).not.toHaveBeenCalled()
  expect(f.io.fetch).not.toHaveBeenCalled()
  expect(f.io.readTextFile).not.toHaveBeenCalled()
})
it.each([false, true])('error golden texts (TTY=%s)', async tty => {
  const texts: Record<string, string> = {}
  for (const [name, args] of [
    ['unknown option', ['node', 'list', '--frobnicate']],
    ['missing required option', ['node', 'create', 'note']],
    ['not running', ['project', 'list']],
    ['unknown command', ['nodes', 'list']],
  ] as const) {
    const f = fixture(tty)
    // Each fixture must finish before checking the next captured error.
    // eslint-disable-next-line no-await-in-loop
    const code = await run([...args], f.io)
    expect(code).toBe(name === 'not running' ? 3 : 2)
    expect(f.out()).toBe('')
    expect(f.io.fetch).not.toHaveBeenCalled()
    expect(f.err()).not.toContain('To specify a positional argument')
    texts[name] = f.err()
  }
  expect(texts).toMatchSnapshot()
})
it.each([
  ['--spaec', 'Did you mean --space?'],
  ['--space-n', 'Did you mean --space-name?'],
  ['--frobnicate', undefined],
])('bounds option suggestions for %s', async (flag, suggestion) => {
  const f = fixture()
  expect(await run(['node', 'list', flag!], f.io)).toBe(2)
  const error = JSON.parse(f.err()).error
  if (suggestion) {
    expect(error.hint).toContain(suggestion)
  } else {
    expect(error.hint).not.toContain('Did you mean')
  }
  expect(error.hint).toContain('Run "opencove node list --help" to see its options.')
})
it('does not suggest unrelated commands', async () => {
  const f = fixture()
  expect(await run(['frobnicate'], f.io)).toBe(2)
  expect(f.err()).not.toContain('Did you mean')
  expect(f.err()).toContain('opencove --help')
})
it('reports a missing scalar option in command context', async () => {
  const f = fixture()
  expect(await run(['space', 'get'], f.io)).toBe(2)
  expect(JSON.parse(f.err()).error.message).toBe(
    'Missing required option --space for "opencove space get".',
  )
})
it('reports only the explicitly searched profile', async () => {
  const f = fixture()
  expect(await run(['project', 'list', '--user-data', '.codex-out/tmp/selected'], f.io)).toBe(3)
  expect(JSON.parse(f.err()).error.details).toEqual({ profiles: ['.codex-out/tmp/selected'] })
})
it('distinguishes an unreachable explicit endpoint', async () => {
  const f = fixture()
  f.io.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
  expect(
    await run(['ping', '--endpoint', 'http://localhost:1234', '--token', 'secret'], f.io),
  ).toBe(3)
  expect(JSON.parse(f.err()).error.message).toBe(
    'OpenCove endpoint http://localhost:1234 is unreachable.',
  )
  expect(f.err()).not.toContain('secret')
  expect(f.io.readTextFile).not.toHaveBeenCalled()
})
it('shows required options and positional arguments in command usage', async () => {
  const f = fixture()
  expect(await run(['api', 'schema', '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('Usage: opencove api schema <operation-id> [options]')
  const g = fixture()
  expect(await run(['space', 'get', '--help'], g.io)).toBe(0)
  expect(g.out()).toContain('Usage: opencove space get --space <id> [options]')
})
it('documents the supported browser modes and task priorities', async () => {
  const website = fixture()
  const task = fixture()
  await Promise.all([
    run(['node', 'create', 'website', '--help'], website.io),
    run(['node', 'create', 'task', '--help'], task.io),
  ])
  expect(website.out()).toContain('--session-mode <shared|incognito|profile>')
  expect(task.out()).toContain('--priority <low|medium|high|urgent>')
})
