import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

it.each([
  { input: '\x1b[200~first line\rsecond line\x1b[201~', label: 'STATE_PASTE' },
  { input: 'first line\rsecond line', label: 'STATE_UNBRACKETED' },
])('the state-restore fixture truthfully reports $label input', async ({ input, label }) => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-state-stub-'))
  const child = spawn(
    process.execPath,
    [
      resolve('scripts/test-agent-session-stub.mjs'),
      'codex',
      root,
      'new',
      'default-model',
      '',
      'raw-agent-terminal-state-restore',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        HOME: root,
        USERPROFILE: root,
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const exited = once(child, 'exit')
  let output = ''
  child.stdout.setEncoding('utf8').on('data', data => {
    output += data
  })
  child.stderr.resume()
  try {
    await vi.waitFor(() => expect(output).toContain('STATE_HISTORY_08'))
    child.stdin.write(input)
    await vi.waitFor(() => expect(output).toContain(label))
    if (label === 'STATE_PASTE') {
      expect(output).toContain(`${label} ${JSON.stringify(input)}`)
    } else {
      expect(output).not.toContain('STATE_PASTE')
    }
    expect(output).toContain('\x1b[?1049h')
    expect(output).toContain('\x1b[?2004h\x1b[?1003h\x1b[?1006h')
  } finally {
    child.stdin.end()
    const fallback = setTimeout(() => child.kill('SIGKILL'), 1_000)
    try {
      await exited
    } finally {
      clearTimeout(fallback)
    }
    await rm(root, { recursive: true, force: true })
  }
})
