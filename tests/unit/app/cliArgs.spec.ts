import { parse } from '../../../src/app/cli/core/args'

it('new parser preserves opaque tokens and whitespace', () => {
  const result = parse(['--token=--opaque-token', '--text=  padded\n'], {
    token: { type: 'string', description: 'Token' },
    text: { type: 'string', description: 'Text' },
  })
  expect(result.values).toEqual({ token: '--opaque-token', text: '  padded\n' })
})
