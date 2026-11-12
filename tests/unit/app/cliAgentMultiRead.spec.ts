// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

function fixture() {
  const f = identityFixture()
  f.values['node.list'] = { nodes: [node, { ...node, id: 'other-123456', title: 'Reviewer' }] }
  f.values['node.get'] = { node: { ...node, id: 'unrelated' } }
  const original = f.io.fetch
  f.io.fetch = async (url, init) => {
    const req = JSON.parse(String(init?.body))
    if (req.id === 'agent.finalMessage') {
      f.requests.push(req)
      return new Response(
        JSON.stringify(
          req.payload.nodeId === node.id
            ? { ok: false, error: { code: 'common.forbidden' } }
            : {
                ok: true,
                value: {
                  nodeId: req.payload.nodeId,
                  sessionId: 's',
                  message: 'Reply',
                  source: 'hook',
                  persisted: true,
                },
              },
        ),
      )
    }
    return original(url, init)
  }
  return f
}
it('keeps mixed successes and selector failures in input order, using the first failing exit', async () => {
  const f = fixture()
  expect(
    await run(
      [
        'agent',
        'read',
        '--node',
        '@self',
        '--node',
        'Reviewer',
        '--node',
        'missing',
        '--node',
        'Reviewer',
      ],
      f.io,
    ),
  ).toBe(4)
  expect(JSON.parse(f.out())).toEqual([
    { node: '@self', ok: false, error: expect.objectContaining({ code: 'common.forbidden' }) },
    expect.objectContaining({
      node: 'Reviewer',
      ok: true,
      nodeId: 'other-123456',
      message: 'Reply',
    }),
    { node: 'missing', ok: false, error: expect.objectContaining({ code: 'node.not_found' }) },
    expect.objectContaining({ node: 'Reviewer', ok: true, message: 'Reply' }),
  ])
})
it('returns zero for all successes and allows fields projection', async () => {
  const f = fixture()
  expect(
    await run(
      ['agent', 'read', '--node', 'Reviewer', '--node', 'Reviewer', '--fields', 'node,ok,message'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual(
    Array(2).fill({ node: 'Reviewer', ok: true, message: 'Reply' }),
  )
})
it('supports batch screens with the single-read result fields', async () => {
  const f = fixture()
  f.values['session.get'] = { sessionId: 's' }
  f.values['session.presentationSnapshot'] = {
    sessionId: 's',
    cols: 80,
    rows: 24,
    bufferKind: 'normal',
    serializedScreen: 'Ready',
  }
  expect(
    await run(['agent', 'read', '--node', 'Reviewer', '--node', 'Reviewer', '--screen'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual(
    Array(2).fill(
      expect.objectContaining({
        node: 'Reviewer',
        ok: true,
        sessionId: 's',
        lines: expect.any(Array),
      }),
    ),
  )
})
it.each(['--turn', '--expect-turn'])('refuses batch %s before connecting', async flag => {
  const f = fixture()
  expect(
    await run(['agent', 'read', '--node', '@self', '--node', 'Reviewer', flag, 'turn-1'], f.io),
  ).toBe(2)
  expect(f.error().message).toContain(flag)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('accepts ten targets but refuses eleven before connecting', async () => {
  const f = fixture()
  expect(await run(['agent', 'read', ...Array(10).fill(['--node', 'Reviewer']).flat()], f.io)).toBe(
    0,
  )
  expect(JSON.parse(f.out())).toHaveLength(10)
  const over = fixture()
  expect(
    await run(['agent', 'read', ...Array(11).fill(['--node', 'Reviewer']).flat()], over.io),
  ).toBe(2)
  expect(over.error().message).toContain('10')
  expect(over.fetch).not.toHaveBeenCalled()
})

it('isolates an empty first selector and still reads the remaining target', async () => {
  const f = fixture()
  expect(await run(['agent', 'read', '--node', '', '--node', 'Reviewer'], f.io)).toBe(1)
  expect(JSON.parse(f.out())).toEqual([
    { node: '', ok: false, error: expect.objectContaining({ code: 'node.not_found' }) },
    expect.objectContaining({ node: 'Reviewer', ok: true, message: 'Reply' }),
  ])
})
it('honors --pretty for the default batch JSON output', async () => {
  const f = fixture()
  expect(
    await run(['agent', 'read', '--node', 'Reviewer', '--node', 'Reviewer', '--pretty'], f.io),
  ).toBe(0)
  expect(f.out()).toBe(JSON.stringify(JSON.parse(f.out()), null, 2) + '\n')
})
