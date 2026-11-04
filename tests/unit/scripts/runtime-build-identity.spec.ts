import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HmrContext, Plugin } from 'vite'
import config from '../../../electron.vite.config'
import * as buildIdentity from '../../../scripts/lib/runtime-build-identity'
import { runtimeBuildFixture } from '../../helpers/runtimeBuild'

afterEach(() => vi.restoreAllMocks())

describe('runtime source identity', () => {
  it('invalidates the renderer identity when development source changes through HMR', async () => {
    // This unit checks config wiring and HMR routing; real hashing has an isolated integration test.
    vi.spyOn(buildIdentity, 'createRuntimeBuildIdentity').mockReturnValue(runtimeBuildFixture)
    const resolved =
      typeof config === 'function'
        ? await config({ command: 'serve', mode: 'development' })
        : config
    const plugin = resolved.renderer?.plugins?.find(
      value =>
        value &&
        typeof value === 'object' &&
        'name' in value &&
        value.name === 'opencove:runtime-build',
    ) as Plugin
    const changed = { id: 'changed-source' }
    const embedded = { id: 'embedded-runtime-identity' }
    const invalidateModule = vi.fn()
    const context = {
      modules: [changed],
      server: {
        moduleGraph: {
          getModulesByFile: () => new Set([embedded]),
          invalidateModule,
        },
      },
    } as unknown as HmrContext
    expect(plugin.handleHotUpdate).toBeTypeOf('function')
    const hook = plugin.handleHotUpdate as (ctx: HmrContext) => unknown
    expect(hook(context)).toEqual([changed, embedded])
    expect(invalidateModule).toHaveBeenCalledWith(embedded)
  })

  it('shares identity across checkout line endings and enumeration order', () => {
    expect(
      buildIdentity.fingerprintRuntimeSources([
        ['a.ts', 'a\r\nb'],
        ['b.ts', 'b'],
      ]),
    ).toBe(
      buildIdentity.fingerprintRuntimeSources([
        ['b.ts', 'b'],
        ['a.ts', 'a\nb'],
      ]),
    )
  })

  it('identifies uncommitted source, dependency and path changes', () => {
    const baseline = buildIdentity.fingerprintRuntimeSources([
      ['src/a.ts', 'same'],
      ['pnpm-lock.yaml', 'v1'],
    ])
    expect(
      buildIdentity.fingerprintRuntimeSources([
        ['src/a.ts', 'changed'],
        ['pnpm-lock.yaml', 'v1'],
      ]),
    ).not.toBe(baseline)
    expect(
      buildIdentity.fingerprintRuntimeSources([
        ['src/a.ts', 'same'],
        ['pnpm-lock.yaml', 'v2'],
      ]),
    ).not.toBe(baseline)
    expect(
      buildIdentity.fingerprintRuntimeSources([
        ['src/b.ts', 'same'],
        ['pnpm-lock.yaml', 'v1'],
      ]),
    ).not.toBe(baseline)
  })
})
