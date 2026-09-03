import { readFlagValue, stripGlobalOptions } from '../../../src/app/cli/args.mjs'

describe('CLI argument parsing', () => {
  it('preserves opaque leading-hyphen bearer tokens through inline syntax', () => {
    const argv = ['ping', '--token=--opaque-token', '--pretty']

    expect(readFlagValue(argv, '--token')).toBe('--opaque-token')
    expect(stripGlobalOptions(argv)).toEqual(['ping'])
  })
})
