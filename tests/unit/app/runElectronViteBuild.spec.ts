import { describe, expect, it } from 'vitest'
import {
  buildElectronViteEnv,
  ensureMaxOldSpaceSizeOption,
  resolveBuildHeapLimitMb,
} from '../../../scripts/run-electron-vite-build.mjs'

describe('run-electron-vite-build', () => {
  it('adds a 4 GB heap floor when NODE_OPTIONS is empty', () => {
    expect(ensureMaxOldSpaceSizeOption(undefined)).toBe('--max-old-space-size=4096')
    expect(ensureMaxOldSpaceSizeOption('   ')).toBe('--max-old-space-size=4096')
  })

  it('preserves an explicit heap limit', () => {
    expect(ensureMaxOldSpaceSizeOption('--max-old-space-size=6144')).toBe(
      '--max-old-space-size=6144',
    )
    expect(ensureMaxOldSpaceSizeOption('--trace-warnings --max-old-space-size 3072')).toBe(
      '--trace-warnings --max-old-space-size 3072',
    )
  })

  it('appends the heap floor without dropping existing node options', () => {
    expect(ensureMaxOldSpaceSizeOption('--trace-warnings')).toBe(
      '--trace-warnings --max-old-space-size=4096',
    )
  })

  it('allows an override for constrained environments', () => {
    expect(resolveBuildHeapLimitMb('6144')).toBe(6144)
    expect(resolveBuildHeapLimitMb('0')).toBe(4096)
    expect(
      buildElectronViteEnv({
        NODE_OPTIONS: '--trace-warnings',
        OPENCOVE_BUILD_MAX_OLD_SPACE_SIZE_MB: '5120',
      }).NODE_OPTIONS,
    ).toBe('--trace-warnings --max-old-space-size=5120')
  })
})
