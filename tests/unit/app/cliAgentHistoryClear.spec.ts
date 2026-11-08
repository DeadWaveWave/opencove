// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

it.each([0, 3])(
  'prints separate archive and memory removal counts and exits zero: %s',
  async removed => {
    const f = identityFixture()
    const result = {
      nodeId: node.id,
      memoryRemoved: removed,
      archive: { status: 'cleared', removed },
    }
    f.values['agent.history.clear'] = result
    expect(await run(['agent', 'history', 'clear', '--node', 'Shell'], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual(result)
    expect(f.requests.find(r => r.id === 'agent.history.clear')).toMatchObject({
      kind: 'command',
      payload: { nodeId: node.id },
    })
  },
)

it('reports memory removal and archive unavailability on stderr with exit one', async () => {
  const f = identityFixture()
  const original = f.io.fetch
  const details = {
    reason: 'archive_unavailable',
    nodeId: node.id,
    memoryRemoved: 2,
    archive: { status: 'unavailable' },
  }
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'agent.history.clear'
      ? new Response(JSON.stringify({ ok: false, error: { code: 'common.unavailable', details } }))
      : original(url, init)
  expect(await run(['agent', 'history', 'clear', '--node', 'Shell'], f.io)).toBe(1)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({
    code: 'common.unavailable',
    message: expect.stringContaining('2 in-memory'),
    details,
  })
  expect(f.error().message).toContain('archive unavailable')
})

it('says a remote agent keeps its stored replies on its own Worker', async () => {
  const f = identityFixture()
  const original = f.io.fetch
  const details = {
    reason: 'remote_history_unavailable',
    nodeId: node.id,
    memoryRemoved: 0,
    archive: { status: 'cleared', removed: 0 },
  }
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'agent.history.clear'
      ? new Response(JSON.stringify({ ok: false, error: { code: 'common.unavailable', details } }))
      : original(url, init)
  expect(await run(['agent', 'history', 'clear', '--node', 'Shell'], f.io)).toBe(1)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({ code: 'common.unavailable', details })
  expect(f.error().message).toContain('remote Worker')
})

it('requires a node selector before connecting', async () => {
  const f = identityFixture()
  expect(await run(['agent', 'history', 'clear'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('documents history deletion boundaries in offline help', async () => {
  const f = identityFixture()
  expect(await run(['agent', 'history', 'clear', '--help'], f.io)).toBe(0)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.out()).toContain('provider transcripts')
  expect(f.out()).toContain('backups')
  expect(f.out()).toMatchSnapshot()
})
