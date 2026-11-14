// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who } from './cliIdentity.helpers'
const rows = [
  {
    nodeId: 'child',
    title: 'Scout\u001b[2J',
    kind: 'agent',
    depth: 2,
    spawnedBy: who.nodeId,
    sessionId: 's',
    sessionStartedAt: null,
    state: 'running',
  },
  {
    nodeId: 'shell',
    title: 'Shell',
    kind: 'terminal',
    depth: 3,
    spawnedBy: 'child',
    sessionId: 'stale',
    sessionStartedAt: null,
    state: 'starting',
  },
]
function fixture() {
  const f = identityFixture()
  f.values['system.whoami'] = {
    ...who,
    lineageQuota: {
      depth: 1,
      maxDepth: 3,
      liveInTree: 2,
      maxLiveInTree: 6,
      remainingLiveInTree: 4,
      nodes: rows,
    },
  }
  f.values['agent.list'] = {
    agents: [
      {
        nodeId: 'child',
        sessionId: 's',
        state: 'waiting',
        quality: 'authoritative',
        blockedReason: 'permission',
        turn: { id: 't' },
      },
      { nodeId: 'shell', sessionId: 'replacement', state: 'idle' },
    ],
  }
  return f
}
it('joins census rows by node and session without dropping unmatched occupants', async () => {
  const f = fixture()
  expect(await run(['whoami', '--tree'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).tree.occupants).toMatchObject([
    {
      ...rows[0],
      workState: {
        state: 'waiting',
        blockedReason: 'permission',
        turnId: 't',
        quality: 'authoritative',
      },
      actions: [{ command: 'opencove agent stop --node child' }],
    },
    { ...rows[1], workState: { state: 'unknown' }, actions: [] },
  ])
  expect(f.requests.filter(r => r.id === 'agent.list')).toHaveLength(1)
})
it('renders a safe indented tree with fresh terminal lookup', async () => {
  const f = fixture()
  f.io.stdout.isTTY = true
  expect(await run(['whoami', '--tree'], f.io)).toBe(0)
  expect(f.out()).toContain('Agents: 2 of 6 running in your tree; depth 1 of 3')
  expect(f.out()).toContain('4 more can start')
  expect(f.out()).toContain('waiting (permission)')
  expect(f.out()).toContain('opencove node get --node shell --fields sessionId')
  expect(f.out()).not.toContain('stale')
  expect(f.out()).not.toContain('\u001b')
  expect(f.out()).toContain('Idle agents still occupy slots; check before stopping.')
})
it('retains known counts and refuses an older Worker without census rows', async () => {
  const f = fixture()
  delete (f.values['system.whoami'] as { lineageQuota: { nodes?: unknown } }).lineageQuota.nodes
  expect(await run(['whoami', '--tree', '-o', 'json'], f.io)).toBe(5)
  expect(f.error()).toMatchObject({
    hint: expect.stringContaining('Update OpenCove'),
    details: { identity: { lineageQuota: { liveInTree: 2 } } },
  })
  expect(f.out()).toBe('')
})
it('keeps the existing empty identity path outside a canvas grant', async () => {
  const f = identityFixture(false)
  expect(await run(['whoami', '--tree'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    caller: 'bearer',
    scope: 'admin',
    nodeId: null,
    sessionId: null,
    projectId: null,
    spaceId: null,
  })
  expect(f.requests.some(r => r.id === 'agent.list')).toBe(false)
})
it('keeps the census when work-state lookup fails and never joins another node with the same session', async () => {
  const f = fixture()
  f.values['agent.list'] = { agents: [{ nodeId: 'wrong', sessionId: 's', state: 'idle' }] }
  expect(await run(['whoami', '--tree', '-o', 'json'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).tree.occupants[0].workState.state).toBe('unknown')
  const failed = fixture(),
    fetch = failed.io.fetch
  failed.io.fetch = (url, init) =>
    JSON.parse(String(init?.body)).id === 'agent.list'
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'common.unexpected', message: 'Unavailable' },
            }),
          ),
        )
      : fetch(url, init)
  expect(await run(['whoami', '--tree'], failed.io)).toBe(0)
  expect(JSON.parse(failed.out()).tree.occupants).toHaveLength(2)
})
it('does not promise more launches when the caller is at the depth limit', async () => {
  const f = fixture()
  ;(f.values['system.whoami'] as { lineageQuota: { depth: number } }).lineageQuota.depth = 3
  f.io.stdout.isTTY = true
  expect(await run(['whoami', '--tree'], f.io)).toBe(0)
  expect(f.out()).toContain('0 more can start at your depth (4 slots available)')
})
it('preserves standalone session-grant identity without inventing a quota tree', async () => {
  const f = identityFixture()
  f.values['system.whoami'] = { ...who, nodeId: null }
  expect(await run(['whoami', '--tree'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({ caller: 'session-grant', nodeId: null })
  expect(JSON.parse(f.out())).not.toHaveProperty('tree')
})
it.each([[['whoami']], [['context', '--space', 'space-123456']]])(
  'keeps ordinary %j byte-identical even if a Worker sends extra rows',
  async command => {
    const withRows = fixture(),
      legacy = fixture()
    delete (legacy.values['system.whoami'] as { lineageQuota: { nodes?: unknown } }).lineageQuota
      .nodes
    expect(await run(command, withRows.io)).toBe(0)
    expect(await run(command, legacy.io)).toBe(0)
    expect(withRows.out()).toBe(legacy.out())
    const result = JSON.parse(withRows.out())
    expect((result.self ?? result).lineageQuota).not.toHaveProperty('nodes')
    expect(withRows.requests.find(r => r.id === 'system.whoami')?.payload).toEqual({})
  },
)
it('prints known quota before the older-Worker TTY error and preserves JSON details', async () => {
  const f = fixture()
  const identity = f.values['system.whoami'] as {
    lineageQuota: { nodes?: unknown; liveInTree: number; remainingLiveInTree: number }
  }
  delete identity.lineageQuota.nodes
  identity.lineageQuota.liveInTree = 4
  identity.lineageQuota.remainingLiveInTree = 2
  f.io.stdout.isTTY = true
  f.io.stderr.isTTY = true
  let stderr = ''
  f.io.stderr.write = text => {
    stderr += text
  }
  expect(await run(['whoami', '--tree'], f.io)).toBe(5)
  expect(f.out()).toBe('')
  expect(stderr).toMatch(
    /^Agents: 4 of 6 running in your tree; depth 1 of 3\nerror\[cli.unsupported\]/,
  )
  stderr = ''
  expect(await run(['whoami', '--tree', '-o', 'json'], f.io)).toBe(5)
  expect(JSON.parse(stderr).error.details.identity.lineageQuota).toMatchObject({
    liveInTree: 4,
    remainingLiveInTree: 2,
  })
})
it.each(['\u202e', '\u2067'])(
  'escapes bidi %j in tree rows without altering JSON titles or actions',
  async control => {
    const title = `Lead${control} forged command`
    const setup = () => {
      const f = fixture()
      const identity = f.values['system.whoami'] as { lineageQuota: { nodes: typeof rows } }
      identity.lineageQuota.nodes = rows.map(row => ({ ...row, title }))
      return f
    }
    const tty = setup(),
      json = setup()
    tty.io.stdout.isTTY = true
    expect(await run(['whoami', '--tree'], tty.io)).toBe(0)
    expect(tty.out()).not.toContain(control)
    expect(tty.out()).toContain('\\u' + control.charCodeAt(0).toString(16))
    expect(tty.out()).toContain('opencove agent stop --node child')
    expect(await run(['whoami', '--tree', '-o', 'json'], json.io)).toBe(0)
    expect(JSON.parse(json.out()).tree.occupants[0]).toMatchObject({
      title,
      actions: [{ command: 'opencove agent stop --node child' }],
    })
  },
)
