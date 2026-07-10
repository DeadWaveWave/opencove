import type { ResolvedUiTheme } from '../../../shared/contracts/dto'

export const UI_LANGUAGES = ['en', 'zh-CN'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

export const UI_THEMES = ['system', 'light', 'dark', 'ember', 'ember-light'] as const
export type UiTheme = (typeof UI_THEMES)[number]

export type UiThemeBaseScheme = ResolvedUiTheme | 'system'

export interface UiThemeDescriptor {
  id: UiTheme
  baseScheme: UiThemeBaseScheme
  terminalScheme: UiThemeBaseScheme
  i18nKey: string
}

export const UI_THEME_DESCRIPTORS: Record<UiTheme, UiThemeDescriptor> = {
  system: { id: 'system', baseScheme: 'system', terminalScheme: 'system', i18nKey: 'system' },
  light: { id: 'light', baseScheme: 'light', terminalScheme: 'light', i18nKey: 'light' },
  dark: { id: 'dark', baseScheme: 'dark', terminalScheme: 'dark', i18nKey: 'dark' },
  ember: { id: 'ember', baseScheme: 'dark', terminalScheme: 'dark', i18nKey: 'ember' },
  'ember-light': {
    id: 'ember-light',
    baseScheme: 'light',
    terminalScheme: 'dark',
    i18nKey: 'emberLight',
  },
}

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en'

export function isValidUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && UI_LANGUAGES.includes(value as UiLanguage)
}

export function isValidUiTheme(value: unknown): value is UiTheme {
  return typeof value === 'string' && (UI_THEMES as readonly string[]).includes(value)
}

export function resolveUiThemeBaseScheme(theme: UiTheme, prefersDark: boolean): ResolvedUiTheme {
  const baseScheme = UI_THEME_DESCRIPTORS[theme].baseScheme
  if (baseScheme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return baseScheme
}

export function resolveUiThemeTerminalScheme(
  theme: UiTheme,
  resolvedBaseScheme: ResolvedUiTheme,
): ResolvedUiTheme {
  const terminalScheme = UI_THEME_DESCRIPTORS[theme].terminalScheme
  return terminalScheme === 'system' ? resolvedBaseScheme : terminalScheme
}
