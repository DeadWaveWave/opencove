import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isNormalizedAgentSettings,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import {
  isValidUiTheme,
  resolveUiThemeBaseScheme,
  resolveUiThemeTerminalScheme,
} from '../../../src/contexts/settings/domain/uiSettings'
import { applyUiLanguage, translate } from '../../../src/app/renderer/i18n'
import { getUiThemeLabel } from '../../../src/app/renderer/i18n/labels'
import {
  readPersistedState,
  toPersistedState,
  writeRawPersistedState,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence'
import { installMockStorage } from '../../support/persistenceTestStorage'

installMockStorage()

beforeEach(() => window.localStorage.clear())
afterEach(async () => {
  await applyUiLanguage('en')
})

describe('named UI themes', () => {
  it.each(['system', 'light', 'dark', 'ember', 'ember-light', 'pixel', 'pixel-light'])(
    'preserves the persisted %s theme through settings normalization',
    async uiTheme => {
      const settings = normalizeAgentSettings({ uiTheme })
      expect(settings.uiTheme).toBe(uiTheme)
      expect(isValidUiTheme(uiTheme)).toBe(true)
      expect(isNormalizedAgentSettings(settings)).toBe(true)

      await writeRawPersistedState(JSON.stringify(toPersistedState([], null, settings)))
      expect((await readPersistedState())?.settings.uiTheme).toBe(uiTheme)
    },
  )

  it.each([{}, { uiTheme: null }, { uiTheme: 'future-theme' }])(
    'defaults to Pixel for missing or unrecognized theme settings: %j',
    value => {
      expect(normalizeAgentSettings(value).uiTheme).toBe('pixel')
      expect(DEFAULT_AGENT_SETTINGS.uiTheme).toBe('pixel')
    },
  )

  it('keeps Pixel shell and terminal dark independently of the system preference', () => {
    expect(resolveUiThemeBaseScheme('pixel', false)).toBe('dark')
    expect(resolveUiThemeBaseScheme('pixel', true)).toBe('dark')
    expect(resolveUiThemeTerminalScheme('pixel', 'light')).toBe('dark')
    expect(resolveUiThemeTerminalScheme('pixel', 'dark')).toBe('dark')
    expect(resolveUiThemeTerminalScheme('ember-light', 'light')).toBe('dark')
    expect(resolveUiThemeTerminalScheme('system', 'light')).toBe('light')
  })

  it('resolves the Pixel label through both supported interface languages', async () => {
    await applyUiLanguage('en')
    expect(getUiThemeLabel(translate, 'pixel')).toBe('Pixel')
    expect(getUiThemeLabel(translate, 'pixel-light')).toBe('Pixel Light')
    await applyUiLanguage('zh-CN')
    expect(getUiThemeLabel(translate, 'pixel')).toBe('空间点阵')
    expect(getUiThemeLabel(translate, 'pixel-light')).toBe('浅色点阵')
  })

  it('keeps the Pixel Light shell and terminal light independently of system preference', () => {
    expect(resolveUiThemeBaseScheme('pixel-light', false)).toBe('light')
    expect(resolveUiThemeBaseScheme('pixel-light', true)).toBe('light')
    expect(resolveUiThemeTerminalScheme('pixel-light', 'light')).toBe('light')
    expect(resolveUiThemeTerminalScheme('pixel-light', 'dark')).toBe('light')
  })
})
