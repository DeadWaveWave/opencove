import { describe, expect, it } from 'vitest'
import { normalizePluginThemes } from './pluginHostExtensionValidation'

const theme = { id: 'night', title: 'Night', appearance: 'dark', extends: 'pixel' }
describe('advanced theme contract', () => {
  it('accepts a pure visual inheritance package and structured material/metrics/motion overrides', () => {
    expect(normalizePluginThemes([theme])[0]).toMatchObject({ extends: 'pixel', tokens: {} })
    expect(
      normalizePluginThemes([
        {
          ...theme,
          stylesheet: './skin.css',
          tokens: {
            '--cove-node-background-image': 'linear-gradient(90deg, #112233, #223344)',
            '--cove-accent': 'oklch(80% 0.1 220)',
          },
          typography: { fontFamily: 'Studio Sans, sans-serif' },
          metrics: { headerHeight: 42 },
          motion: {
            creation: {
              preset: 'custom',
              durationMs: 450,
              keyframes: [{ opacity: 0 }, { opacity: 1 }],
            },
          },
        },
      ])[0],
    ).toMatchObject({ stylesheet: 'skin.css', metrics: { headerHeight: 42 } })
  })
  it.each([
    { ...theme, extends: 'plugin:missing:night' },
    { ...theme, appearance: 'light' },
    { ...theme, stylesheet: '../skin.css' },
    { ...theme, stylesheet: '/skin.css' },
    { ...theme, stylesheet: 'C:\\skin.css' },
    { ...theme, tokens: { '--cove-text': 'red; display:none' } },
    { ...theme, tokens: { '--cove-text': 'url(file:///tmp/secret)' } },
    { ...theme, metrics: { headerHeight: 500 } },
    { ...theme, motion: { unfold: { durationMs: 5000 } } },
  ])('rejects unsupported foundation, escaping resource and invalid presentation %#', invalid => {
    expect(() => normalizePluginThemes([invalid])).toThrow()
  })
})
