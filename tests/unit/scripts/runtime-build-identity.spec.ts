import { describe, expect, it, vi } from 'vitest'
import type { HmrContext, Plugin } from 'vite'
import config from '../../../electron.vite.config'
import { fingerprintRuntimeSources } from '../../../scripts/lib/runtime-build-identity'

describe('runtime source identity', () => {
  it('invalidates the renderer identity when development source changes through HMR', async () => {
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
      fingerprintRuntimeSources([
        ['a.ts', 'a\r\nb'],
        ['b.ts', 'b'],
      ]),
    ).toBe(
      fingerprintRuntimeSources([
        ['b.ts', 'b'],
        ['a.ts', 'a\nb'],
      ]),
    )
  })

  it('identifies uncommitted source, dependency and path changes', () => {
    const baseline = fingerprintRuntimeSources([
      ['src/a.ts', 'same'],
      ['pnpm-lock.yaml', 'v1'],
    ])
    expect(
      fingerprintRuntimeSources([
        ['src/a.ts', 'changed'],
        ['pnpm-lock.yaml', 'v1'],
      ]),
    ).not.toBe(baseline)
    expect(
      fingerprintRuntimeSources([
        ['src/a.ts', 'same'],
        ['pnpm-lock.yaml', 'v2'],
      ]),
    ).not.toBe(baseline)
    expect(
      fingerprintRuntimeSources([
        ['src/b.ts', 'same'],
        ['pnpm-lock.yaml', 'v1'],
      ]),
    ).not.toBe(baseline)
  })
})
