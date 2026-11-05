import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'

it('records the history read by the ready resumed provider and accepts a fresh turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-file-fixture-'))
  const log = join(root, 'invocations.jsonl')
  const fixture = resolve('tests/e2e/fixtures/codex-session-file-provider.mjs')
  const children: Array<ReturnType<typeof start>> = []
  function start(args: string[]) {
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        // Only the fixture's raw input adapter is replaced; file IO and lifecycle are real.
        `process.stdin.setRawMode = () => process.stdin;
         process.argv = [process.execPath, ${JSON.stringify(fixture)}, ...${JSON.stringify(args)}];
         await import(${JSON.stringify(pathToFileURL(fixture).href)});`,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CODEX_HOME: join(root, 'codex-home'),
          OPENCOVE_SESSION_FILE_FIXTURE_LOG: log,
        },
        stdio: 'pipe',
      },
    )
    const closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => (output += String(chunk)))
    child.stderr.on('data', chunk => (output += String(chunk)))
    const handle = { child, closed, output: () => output }
    children.push(handle)
    return handle
  }
  try {
    const first = start([])
    await vi.waitFor(() => expect(first.output()).toContain('CODEX_FILE_READY='))
    const id = first.output().match(/CODEX_FILE_READY=([^\r\n]+)/)![1]
    first.child.stdin.write('FILE_RESTART_SENTINEL\r')
    await vi.waitFor(() => expect(first.output()).toContain('SAVED_TURN=FILE_RESTART_SENTINEL'), {
      timeout: 3_000,
    })
    first.child.stdin.write('\x03')
    expect(await first.closed).toEqual([0, null])

    const second = start(['resume', id])
    await vi.waitFor(() => expect(second.output()).toContain(`CODEX_FILE_READY=${id}`))
    const invocations = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(invocations).toEqual([
      { event: 'invocation', args: [] },
      { event: 'ready', args: [], sessionId: id, restoredHistory: null },
      { event: 'invocation', args: ['resume', id] },
      {
        event: 'ready',
        args: ['resume', id],
        sessionId: id,
        restoredHistory: expect.stringContaining('"last_agent_message":"FILE_RESTART_SENTINEL"'),
      },
    ])
    // A distinct post-restart turn cannot be satisfied by the persisted screen or command echo.
    second.child.stdin.write('FILE_RESUMED_SENTINEL\r')
    await vi.waitFor(() => expect(second.output()).toContain('SAVED_TURN=FILE_RESUMED_SENTINEL'), {
      timeout: 3_000,
    })
    second.child.stdin.write('\x03')
    expect(await second.closed).toEqual([0, null])
  } finally {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
    }
    await Promise.all(children.map(({ closed }) => closed))
    await rm(root, { recursive: true, force: true })
  }
})
