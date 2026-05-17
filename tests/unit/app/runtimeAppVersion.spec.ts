import path from 'node:path'
import {
  readPackageVersionFromRuntimeDir,
  readRuntimeAppVersion,
} from '../../../src/app/main/controlSurface/runtimeAppVersion'

describe('runtime app version', () => {
  it('resolves the repository package version from source runtime depth', () => {
    expect(readRuntimeAppVersion()).toBe('0.2.0')
  })

  it('resolves the repository package version from bundled main chunk depth', () => {
    expect(readPackageVersionFromRuntimeDir(path.resolve(process.cwd(), 'out/main/chunks'))).toBe(
      '0.2.0',
    )
  })
})
