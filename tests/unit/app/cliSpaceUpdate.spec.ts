// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, project, space } from './cliIdentity.helpers'

const value = {
  id: space.id,
  name: 'Review',
  projectId: project.id,
  parentSpaceId: null,
  directoryPath: '/repo',
  rect: { x: 10, y: 20, width: 420, height: 300 },
  movedNodeIds: [],
}
function fixture() {
  const f = identityFixture()
  f.values['space.update'] = value
  return f
}
it.each(['Main', 'space-', '@self', space.id])(
  'resolves Space selector %s and renames',
  async selector => {
    const f = fixture()
    expect(await run(['space', 'update', '--space', selector, '--name', 'Review'], f.io)).toBe(0)
    expect(f.requests.find(r => r.id === 'space.update')?.payload).toEqual({
      spaceId: space.id,
      name: 'Review',
    })
    expect(JSON.parse(f.out())).toEqual(value)
  },
)
it('projects declared frame and movement fields and reports adjustments', async () => {
  const f = fixture()
  const errors: string[] = []
  f.io.stderr.write = text => {
    errors.push(text)
  }
  f.values['space.update'] = {
    ...value,
    appliedFrame: value.rect,
    frameAdjusted: true,
    movedNodeIds: ['n'],
  }
  expect(
    await run(
      [
        'space',
        'update',
        '--space',
        '@self',
        '--frame',
        '{"width":1}',
        '--fields',
        'id,appliedFrame.width,frameAdjusted,movedNodeIds',
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'space.update')?.payload).toEqual({
    spaceId: space.id,
    frame: { width: 1 },
  })
  expect(JSON.parse(f.out())).toEqual({
    id: space.id,
    appliedFrame: { width: 420 },
    frameAdjusted: true,
    movedNodeIds: ['n'],
  })
  expect(errors.join('')).toContain('Notice: space frame adjusted; applied frame:')
})
it.each([
  ['--space', '@self'],
  ['--name', 'Review'],
  ['--space', '@self', '--name', ' '],
  ...['{}', '[]', '{"width":0}', '{"x":"5"}', '{"x":null}', '{"x":1,"other":2}'].map(frame => [
    '--space',
    '@self',
    '--frame',
    frame,
  ]),
])('rejects invalid input before connecting: %j', async args => {
  const f = fixture()
  expect(await run(['space', 'update', ...args], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('does not retry a CAS conflict or print success', async () => {
  const f = fixture()
  const fetch = f.fetch.getMockImplementation()!
  f.fetch.mockImplementation((url, init) =>
    JSON.parse(String(init?.body)).id === 'space.update'
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'persistence.invalid_state',
                debugMessage: 'The canvas changed. Read the Space again before updating it.',
              },
            }),
          ),
        )
      : fetch(url, init),
  )
  expect(await run(['space', 'update', '--space', '@self', '--name', 'New'], f.io)).toBe(1)
  expect(f.out()).toBe('')
  expect(
    f.fetch.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).id === 'space.update'),
  ).toHaveLength(1)
})
