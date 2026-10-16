import { describe, expect, it } from 'vitest'
import {
  toTransparentTerminalBackground,
  withTerminalBackgroundTransparency,
} from './terminalBackgroundTransparency'

describe('terminal background transparency', () => {
  it.each([
    ['#0c1217', 'rgba(12, 18, 23, 0)'],
    ['#abc', 'rgba(170, 187, 204, 0)'],
    ['#0c1217ff', 'rgba(12, 18, 23, 0)'],
    ['rgb(12, 18, 23)', 'rgba(12, 18, 23, 0)'],
    ['rgba(12, 18, 23, 0.94)', 'rgba(12, 18, 23, 0)'],
    ['rgb(12 18 23 / 0.94)', 'rgba(12, 18, 23, 0)'],
  ])('keeps the plate colour of %s at zero alpha', (input, expected) => {
    // xterm rejects the `transparent` keyword; OSC 11 then reports these rgb channels.
    expect(toTransparentTerminalBackground(input)).toBe(expected)
  })

  it('leaves colours it cannot parse opaque', () => {
    expect(toTransparentTerminalBackground('var(--cove-terminal-background)')).toBe(
      'var(--cove-terminal-background)',
    )
  })

  it('only touches the background, and only when transparency is allowed', () => {
    const theme = { background: '#0c1217', foreground: '#eff3f7' }
    expect(withTerminalBackgroundTransparency(theme, false)).toBe(theme)
    expect(withTerminalBackgroundTransparency(theme, true)).toEqual({
      background: 'rgba(12, 18, 23, 0)',
      foreground: '#eff3f7',
    })
  })
})
