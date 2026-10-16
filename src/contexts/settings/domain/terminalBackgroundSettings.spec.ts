import { describe, expect, it } from 'vitest'
import { normalizeAgentSettings } from './agentSettings'
import {
  isValidTerminalBackgroundMode,
  resolveTerminalTransparentBackground,
} from './terminalBackgroundSettings'

describe('terminal background setting', () => {
  it('accepts only the three modes', () => {
    expect(['auto', 'transparent', 'opaque'].every(isValidTerminalBackgroundMode)).toBe(true)
    expect(isValidTerminalBackgroundMode('glass')).toBe(false)
    expect(isValidTerminalBackgroundMode(undefined)).toBe(false)
  })

  it('keeps a saved mode and reads missing or unknown values as auto', () => {
    expect(normalizeAgentSettings({}).terminalBackground).toBe('auto')
    expect(normalizeAgentSettings({ terminalBackground: 'glass' }).terminalBackground).toBe('auto')
    expect(normalizeAgentSettings({ terminalBackground: 'opaque' }).terminalBackground).toBe(
      'opaque',
    )
  })

  it.each([
    ['auto', 'darwin', true],
    ['auto', 'win32', false],
    ['auto', 'linux', false],
    ['auto', null, false],
    ['transparent', 'win32', true],
    ['opaque', 'darwin', false],
  ] as const)('%s on %s opens xterm transparent: %s', (mode, platform, expected) => {
    expect(resolveTerminalTransparentBackground({ mode, platform })).toBe(expected)
  })
})
