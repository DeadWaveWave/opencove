import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { boundedWorkspace } from './cli.bounded-agent-spawning.helpers'

async function savedCursor(path: string) {
  await expect
    .poll(async () => {
      try {
        return (await readFile(path, 'utf8')).trim().length > 0
      } catch {
        return false
      }
    })
    .toBe(true)
  return (await readFile(path, 'utf8')).trim()
}
const lines = (text: string) =>
  text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))

test('cursor-file survives Ctrl-C, resumes two child ends and supports exact reply reads', async () => {
  test.skip(
    process.platform === 'win32',
    'POSIX SIGINT contract; checkpoint I/O has portable unit coverage',
  )
  test.setTimeout(180_000)
  await boundedWorkspace(async f => {
    const file = join(f.root, 'events.cursor')
    const first = f.command(f.parent, ['events', '--cursor-file', file, '--timeout', '30s'])
    const baseline = await savedCursor(file)
    const pidPath = join(f.root, f.parent.id + '.request.json.pid')
    const pid = Number(await readFile(pidPath, 'utf8'))
    process.kill(pid, 'SIGINT')
    const interrupted = await first
    expect(interrupted.code, interrupted.stderr).toBe(130)
    expect(lines(interrupted.stdout)[0].type).toBe('stream.ready')
    expect((await readFile(file, 'utf8')).trim()).toBe(baseline)
    // These complete while there is no observer; f.child establishes a post-binding hook turn.
    const a = await f.child(f.parent),
      b = await f.child(f.parent)
    const resumed = await f.command(f.parent, [
      'events',
      '--cursor-file',
      file,
      '--until-each-turn',
      '--node',
      a.id,
      '--node',
      b.id,
      '--timeout',
      '20s',
    ])
    expect(resumed.code, resumed.stderr).toBe(0)
    const records = lines(resumed.stdout)
    expect(records[0]).toMatchObject({ type: 'stream.ready', mode: 'resume', cursor: baseline })
    const summaries = lines(resumed.stderr)
    expect(summaries.map(s => s.nodeId)).toEqual([a.id, b.id])
    for (const summary of summaries) {
      // eslint-disable-next-line no-await-in-loop
      const reply = await f.command(f.parent, [
        'agent',
        'read',
        '--node',
        summary.nodeId,
        '--turn',
        summary.turnId,
        '-o',
        'json',
      ])
      expect(reply.code, reply.stderr).toBe(0)
      expect(JSON.parse(reply.stdout)).toMatchObject({
        nodeId: summary.nodeId,
        sessionId: summary.sessionId,
        turnId: summary.turnId,
        outcome: summary.outcome,
        message: 'Strict reply 1',
      })
    }
    expect((await readFile(file, 'utf8')).trim()).toBe(records.at(-1).cursor)
  })
})

test('until-each-turn ignores old ends, honors timeout and waits for both live turns', async () => {
  test.setTimeout(180_000)
  await boundedWorkspace(async f => {
    const a = await f.child(f.parent),
      b = await f.child(f.parent)
    const targets = ['--until-each-turn', '--node', a.id, '--node', b.id]
    const timed = await f.command(f.parent, ['events', ...targets, '--timeout', '500ms'])
    expect(timed.code, timed.stderr).toBe(124)
    expect(lines(timed.stdout).map(r => r.type)).toEqual(['stream.ready'])
    const file = join(f.root, 'live.cursor')
    const watching = f.command(f.parent, [
      'events',
      ...targets,
      '--cursor-file',
      file,
      '--timeout',
      '20s',
    ])
    await savedCursor(file)
    await f.page().evaluate(
      async nodes => {
        await Promise.all(
          nodes.map(node =>
            window.opencoveApi.controlSurface.invoke({
              kind: 'command',
              id: 'session.writeNode',
              payload: { nodeId: node.id, sessionId: node.sessionId, data: 'next turn\r' },
            }),
          ),
        )
      },
      [a, b],
    )
    const result = await watching
    expect(result.code, result.stderr).toBe(0)
    expect(lines(result.stderr)).toEqual(
      [a, b].map(node =>
        expect.objectContaining({
          type: 'events.turn_summary',
          nodeId: node.id,
          sessionId: node.sessionId,
          turnId: expect.any(String),
          outcome: 'completed',
        }),
      ),
    )
    expect(
      new Set(
        lines(result.stdout)
          .filter(r => r.type === 'agent.turn_completed')
          .map(r => r.snapshot.nodeId),
      ),
    ).toEqual(new Set([a.id, b.id]))
  })
})
