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
  it('offers Cove dark, light and system', () => {
    expect(UI_THEMES.map(id => [id, UI_THEME_DESCRIPTORS[id].baseScheme])).toEqual([
      ['dark', 'dark'],
      ['light', 'light'],
      ['system', 'system'],
    ])
  })

  it.each(['system', 'light', 'dark'])(
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
    ['pixel', 'dark'],
    ['pixel-light', 'light'],
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

  it('resolves the shell and terminal schemes, following the system only for system', () => {
    expect(resolveUiThemeBaseScheme('dark', false)).toBe('dark')
    expect(resolveUiThemeBaseScheme('light', true)).toBe('light')
    expect(resolveUiThemeBaseScheme('system', true)).toBe('dark')
    expect(resolveUiThemeBaseScheme('system', false)).toBe('light')
    expect(resolveUiThemeTerminalScheme('dark', 'light')).toBe('dark')
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
})
