// @vitest-environment node
import { expect, it } from 'vitest'
import { parse } from '../../../src/app/cli/core/args'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, space } from './cliIdentity.helpers'

it.each([
  ['text', '-v'],
  ['title', '--draft'],
  ['text', '-'],
  ['requirement', '--review'],
  ['prompt', '-check'],
])('takes --%s value %s literally', (key, value) => {
  expect(
    parse([`--${key}`, value], { [key]: { type: 'string', description: key } }).values[key],
  ).toBe(value)
})
it('keeps boolean flags, unknown options and positional delimiters strict', () => {
  const specs = {
    text: { type: 'string' as const, description: 'Text' },
    pretty: { type: 'boolean' as const, description: 'Pretty' },
  }
  expect(() => parse(['--pretty', '--unknown'], specs)).toThrow('Unknown option --unknown')
  expect(() => parse(['--text', 'hello', '--unknown'], specs)).toThrow('Unknown option --unknown')
  expect(parse(['--', '--text', '-v'], specs).positionals).toEqual(['--text', '-v'])
  expect(parse(['--pretty', 'word'], specs)).toMatchObject({
    values: { pretty: true },
    positionals: ['word'],
  })
})
it('preserves command discovery, duplicate detection and file variants', async () => {
  const f = identityFixture(false)
  expect(
    await run(
      [
        'node',
        'create',
        'note',
        '--space',
        space.id,
        '--text',
        '-v is verbose',
        '--title',
        '--draft',
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'node.create')?.payload).toMatchObject({
    title: '--draft',
    data: { text: '-v is verbose' },
  })
  expect(() =>
    parse(['--text', '-v', '--text', 'again'], { text: { type: 'string', description: 'Text' } }),
  ).toThrow('only be specified once')
  expect(
    parse(['--text-file', '-file'], {
      text: { type: 'string', description: 'Text', fileVariant: true },
    }).values['text-file'],
  ).toBe('-file')
})
