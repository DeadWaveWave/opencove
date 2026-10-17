import { describe, expect, it } from 'vitest'
import { describeUiThemeChoice, resolveUiThemeChoice, uiThemeModesFor } from './uiThemeChoice'

describe('control center theme choice', () => {
  it.each([
    ['dark', 'cove', 'dark'],
    ['light', 'cove', 'light'],
    ['system', 'cove', 'system'],
    ['pixel', 'pixel', 'dark'],
    ['pixel-light', 'pixel', 'light'],
    ['plugin:example:night', null, null],
  ] as const)('reads %s as family %s, mode %s', (theme, family, mode) => {
    expect(describeUiThemeChoice(theme)).toEqual({ family, mode })
  })

  it('offers follow system only where the family has it', () => {
    expect(uiThemeModesFor('cove')).toEqual(['light', 'dark', 'system'])
    expect(uiThemeModesFor('pixel')).toEqual(['light', 'dark'])
  })

  it.each([
    ['cove', 'light', false, 'light'],
    ['cove', 'system', true, 'system'],
    ['pixel', 'dark', false, 'pixel'],
    ['pixel', 'light', true, 'pixel-light'],
    // Pixel has no system mode: keep what the system shows now.
    ['pixel', 'system', true, 'pixel'],
    ['pixel', 'system', false, 'pixel-light'],
  ] as const)('%s in %s mode (system dark %s) is %s', (family, mode, prefersDark, expected) => {
    expect(resolveUiThemeChoice(family, mode, prefersDark)).toBe(expected)
  })
})
