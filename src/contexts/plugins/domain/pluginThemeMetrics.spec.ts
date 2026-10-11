import { describe, expect, it } from 'vitest'
import {
  normalizePluginThemeMetrics,
  normalizePluginThemeTypography,
  pluginThemeMetricTokens,
} from './pluginThemeMetrics'

describe('plugin theme visual metrics', () => {
  it('preserves absent fields and produces only explicitly declared visual overrides', () => {
    expect(normalizePluginThemeMetrics(undefined)).toBeUndefined()
    expect(normalizePluginThemeTypography(undefined)).toBeUndefined()
    expect(pluginThemeMetricTokens({})).toEqual({})
    expect(
      pluginThemeMetricTokens({
        metrics: normalizePluginThemeMetrics({ headerHeight: 44, compactIconSize: 32, radius: 0 }),
        typography: normalizePluginThemeTypography({
          fontFamily: '"Custom UI", sans-serif',
          fontSize: 18,
          titleFontSize: 14,
        }),
      }),
    ).toEqual({
      '--cove-node-header-height': '44px',
      '--cove-compact-icon-size': '32px',
      '--cove-node-radius': '0px',
      '--cove-explorer-radius': '0px',
      '--cove-font-ui': '"Custom UI", sans-serif',
      '--cove-theme-font-scale': '1.125',
      '--cove-node-title-font-size': '14px',
    })
  })

  const invalidMetrics: unknown[] = [
    { headerHeight: 0 },
    { headerHeight: 65 },
    { headerHeight: Number.NaN },
    { compactIconSize: 112 },
    { radius: -1 },
    { collisionWidth: 120 },
    { toString: 30 },
    [],
    null,
  ]
  it.each(invalidMetrics.map(value => ({ value })))(
    'rejects invalid metrics and canvas geometry overrides: $value',
    ({ value }) => {
      expect(() => normalizePluginThemeMetrics(value)).toThrow()
    },
  )

  it.each([
    { fontSize: 0 },
    { titleFontSize: 30 },
    { fontFamily: 'a; color:red' },
    { fontFamily: '' },
    { terminalFontSize: 14 },
    { fontFamily: 12 },
  ])('rejects invalid typography and terminal setting overrides: %j', value => {
    expect(() => normalizePluginThemeTypography(value)).toThrow()
  })
})
