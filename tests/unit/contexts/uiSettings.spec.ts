import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  isNormalizedAgentSettings,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import {
  UI_THEMES,
  UI_THEME_DESCRIPTORS,
  isValidUiTheme,
  normalizeUiTheme,
  resolveUiThemeBaseScheme,
  resolveUiThemeTerminalScheme,
  type UiTheme,
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
  it('offers the Cove family (dark, light, system) and the Pixel family', () => {
    expect(UI_THEMES.map(id => [id, UI_THEME_DESCRIPTORS[id].family])).toEqual([
      ['dark', 'cove'],
      ['light', 'cove'],
      ['system', 'cove'],
      ['pixel', 'pixel'],
      ['pixel-light', 'pixel'],
    ])
  })

  it.each(['system', 'light', 'dark', 'pixel', 'pixel-light'])(
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

  it.each([
    ['ember', 'dark'],
    ['ember-light', 'light'],
  ] as const)('migrates the retired %s theme to Cove %s', async (retired, cove) => {
    expect(isValidUiTheme(retired)).toBe(false)
    expect(normalizeUiTheme(retired)).toBe(cove)
    const settings = normalizeAgentSettings({ uiTheme: retired })
    expect(settings.uiTheme).toBe(cove)
    expect(isNormalizedAgentSettings(settings)).toBe(true)

    const stored = { ...DEFAULT_AGENT_SETTINGS, uiTheme: retired as unknown as UiTheme }
    await writeRawPersistedState(JSON.stringify(toPersistedState([], null, stored)))
    expect((await readPersistedState())?.settings.uiTheme).toBe(cove)
  })

  it.each([{}, { uiTheme: null }, { uiTheme: 'future-theme' }])(
    'defaults to Cove dark for missing or unrecognized theme settings: %j',
    value => {
      expect(normalizeAgentSettings(value).uiTheme).toBe('dark')
      expect(DEFAULT_AGENT_SETTINGS.uiTheme).toBe('dark')
    },
  )

  it('keeps an existing Pixel choice instead of moving it to the new default', () => {
    expect(normalizeAgentSettings({ uiTheme: 'pixel' }).uiTheme).toBe('pixel')
    expect(normalizeAgentSettings({ uiTheme: 'pixel-light' }).uiTheme).toBe('pixel-light')
  })

  it('keeps Pixel shell and terminal dark independently of the system preference', () => {
    expect(resolveUiThemeBaseScheme('pixel', false)).toBe('dark')
    expect(resolveUiThemeBaseScheme('pixel', true)).toBe('dark')
    expect(resolveUiThemeTerminalScheme('pixel', 'light')).toBe('dark')
    expect(resolveUiThemeTerminalScheme('pixel', 'dark')).toBe('dark')
    expect(resolveUiThemeTerminalScheme('system', 'light')).toBe('light')
  })

  it('names the Cove themes in both supported interface languages', async () => {
    await applyUiLanguage('en')
    expect(
      ['dark', 'light', 'system'].map(id => getUiThemeLabel(translate, id as UiTheme)),
    ).toEqual(['Cove', 'Cove Light', 'Cove (System)'])
    await applyUiLanguage('zh-CN')
    expect(
      ['dark', 'light', 'system'].map(id => getUiThemeLabel(translate, id as UiTheme)),
    ).toEqual(['Cove', '浅色 Cove', 'Cove（跟随系统）'])
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
