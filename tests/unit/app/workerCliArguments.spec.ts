import {
  readRepeatedWorkerFlagValues,
  readWorkerFlagValue,
} from '../../../src/app/worker/workerCliArguments'

describe('Worker CLI arguments', () => {
  it('reads an opaque token that starts with option characters from inline syntax', () => {
    expect(readWorkerFlagValue(['--token=--opaque-token'], '--token')).toBe('--opaque-token')
  })

  it('does not consume the next flag when a separate value is missing', () => {
    expect(readWorkerFlagValue(['--token', '--port', '4317'], '--token')).toBeNull()
  })

  it('supports repeated inline approved roots', () => {
    expect(
      readRepeatedWorkerFlagValues(
        ['--approve-root=/repo/one', '--approve-root', '/repo/two'],
        '--approve-root',
      ),
    ).toEqual(['/repo/one', '/repo/two'])
  })
})
