import { describe, expect, it } from 'vitest'
import { normalizePluginThemeMotion } from './pluginThemeMotion'

describe('theme motion contract', () => {
  it('accepts declarative effects and bounded independently timed transitions', () => {
    const motion = {
      background: { preset: 'pixel', durationMs: 10000 },
      creation: {
        preset: 'custom',
        durationMs: 500,
        easing: 'cubic-bezier(0.2, -0.3, 0.8, 1.3)',
        keyframes: [
          { opacity: 0, transform: 'scale(0.9)' },
          { opacity: 1, offset: 1 },
        ],
      },
      working: { preset: 'none' },
      fold: { durationMs: 0 },
      unfold: { durationMs: 480, easing: 'steps(4, end)' },
    }
    expect(normalizePluginThemeMotion(motion)).toEqual(motion)
    expect(normalizePluginThemeMotion(undefined)).toBeUndefined()
  })

  it.each([
    { fold: { durationMs: -1 } },
    { creation: { preset: 'custom', durationMs: 2001 } },
    { working: { preset: 'custom', durationMs: Infinity } },
    { fold: { easing: 'cubic-bezier(-1, 0, 1, 1)' } },
    { fold: { easing: 'steps(1, jump-none)' } },
    { creation: { preset: 'custom', keyframes: [{ offset: 0.7 }, { offset: 0.3 }] } },
    { creation: { preset: 'custom', keyframes: [{ width: '200px' }, { width: '600px' }] } },
    { creation: { preset: 'custom', keyframes: [{ filter: 'url(https://example.com)' }, {}] } },
    { closing: { preset: 'pixel', keyframes: [{ opacity: 0 }, { opacity: 1 }] } },
    { working: { preset: 'javascript' } },
    { navigation: {} },
  ])('rejects geometry mutation, invalid timing and unsupported declarations: %j', raw => {
    expect(() => normalizePluginThemeMotion(raw)).toThrow()
  })
})
