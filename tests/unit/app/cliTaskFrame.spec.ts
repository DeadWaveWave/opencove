// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { task } from './cliAgentMetadata.helpers'
import { identityFixture, space } from './cliIdentity.helpers'

it.each([true, false])(
  'task frame: reports applied geometry and notices adjustments (%s)',
  async adjusted => {
    const f = identityFixture(false)
    let err = ''
    f.io.stderr.write = text => {
      err += text
    }
    const frame = { x: 10, y: 20, width: 220, height: 260 }
    f.values['node.create'] = { node: { ...task, frame } }
    expect(
      await run(
        [
          'node',
          'create',
          'task',
          '--space',
          space.id,
          '--requirement',
          'test',
          '--frame',
          JSON.stringify({ ...frame, width: adjusted ? 100 : 220 }),
        ],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toMatchObject({ appliedFrame: frame, frameAdjusted: adjusted })
    expect(err.includes('frame adjusted')).toBe(adjusted)
  },
)

it.each([undefined, '{"x":10}'])(
  'task frame: omitted dimensions do not count as adjustment (%s)',
  async requested => {
    const f = identityFixture(false)
    let err = ''
    f.io.stderr.write = text => {
      err += text
    }
    const frame = { x: 10, y: 20, width: 220, height: 260 }
    f.values['node.create'] = { node: { ...task, frame } }
    expect(
      await run(
        [
          'node',
          'create',
          'task',
          '--space',
          space.id,
          '--requirement',
          'test',
          '--focus',
          ...(requested ? ['--frame', requested] : []),
        ],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toMatchObject({
      appliedFrame: frame,
      frameAdjusted: false,
      focusError: null,
    })
    expect(err).toBe('')
    expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(1)
  },
)
