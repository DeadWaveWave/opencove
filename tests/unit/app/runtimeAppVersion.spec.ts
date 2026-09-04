import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  readPackageVersionFromRuntimeDir,
  readRuntimeAppVersion,
} from '../../../src/app/main/controlSurface/runtimeAppVersion'

const packageVersion = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../../package.json'), 'utf8'),
).version

describe('runtime app version', () => {
  it('resolves the repository package version from source runtime depth', () => {
    expect(readRuntimeAppVersion()).toBe(packageVersion)
  })

  it('resolves the repository package version from bundled main chunk depth', () => {
    expect(readPackageVersionFromRuntimeDir(path.resolve(process.cwd(), 'out/main/chunks'))).toBe(
      packageVersion,
    )
  })
})
