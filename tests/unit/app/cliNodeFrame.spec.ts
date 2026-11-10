// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node, space } from './cliIdentity.helpers'
import { resolveCreateFrame } from '../../../src/contexts/workspace/application/nodeControl/nodeDataFactory'

it.each([undefined, { x: 10, y: 20 }])(
  'note creation deliberately clamps 400×300 to 360×260 (%j)',
  position => {
    expect(
      resolveCreateFrame({
        kind: 'note',
        size: { width: 252, height: 172 },
        placement: { x: 10, y: 20 },
        frame: { ...position, width: 400, height: 300 },
      }),
    ).toEqual({ x: 10, y: 20, width: 360, height: 260 })
    expect(
      resolveCreateFrame({
        kind: 'note',
        size: { width: 252, height: 172 },
        placement: { x: 10, y: 20 },
        frame: { width: 320, height: 240 },
      }),
    ).toMatchObject({ width: 320, height: 240 })
  },
)
it.each(
  ['create', 'update'].flatMap(action =>
    ['note', 'task', 'website', 'agent', 'terminal'].flatMap(kind =>
      [false, true].map(adjusted => ({ action, kind, adjusted })),
    ),
  ),
)(
  '$action $kind reports requested frame adjustments ($adjusted)',
  async ({ action, kind, adjusted }) => {
    const f = identityFixture(false)
    let stderr = ''
    f.io.stderr.write = text => {
      stderr += text
    }
    const frame = { x: 10, y: 20, width: 360, height: 260 }
    f.values[`node.${action}`] = { node: { ...node, kind, frame } }
    const args = [
      'node',
      action,
      kind,
      ...(action === 'create' ? ['--space', space.id] : ['--node', node.id]),
      ...(action === 'create' && kind === 'task' ? ['--requirement', 'Review'] : []),
      ...(action === 'create' && kind === 'website' ? ['--url', 'https://example.com'] : []),
      '--frame',
      JSON.stringify({ ...frame, width: adjusted ? 400 : 360 }),
    ]
    expect(await run(args, f.io)).toBe(0)
    expect(JSON.parse(f.out())).toMatchObject({ appliedFrame: frame, frameAdjusted: adjusted })
    expect(stderr).toBe(
      adjusted ? `Notice: ${kind} frame adjusted; applied frame: ${JSON.stringify(frame)}.\n` : '',
    )
  },
)
it.each(['create', 'update'])(
  '%s ignores omitted frame components when reporting',
  async action => {
    const f = identityFixture(false)
    const frame = { x: 10, y: 20, width: 360, height: 260 }
    f.values[`node.${action}`] = { node: { ...node, kind: 'note', frame } }
    expect(
      await run(
        [
          'node',
          action,
          'note',
          ...(action === 'create' ? ['--space', space.id] : ['--node', node.id]),
          '--frame',
          '{"x":10}',
        ],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toMatchObject({ appliedFrame: frame, frameAdjusted: false })
  },
)
