import type { ResolvedUiTheme } from '../../../shared/contracts/dto'

export const UI_LANGUAGES = ['en', 'zh-CN'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

export const UI_THEMES = ['system', 'light', 'dark', 'ember'] as const
export type UiTheme = (typeof UI_THEMES)[number]

export type UiThemeBaseScheme = ResolvedUiTheme | 'system'

export interface UiThemeDescriptor {
  id: UiTheme
  baseScheme: UiThemeBaseScheme
  i18nKey: string
}

export const UI_THEME_DESCRIPTORS: Record<UiTheme, UiThemeDescriptor> = {
  system: { id: 'system', baseScheme: 'system', i18nKey: 'system' },
  light: { id: 'light', baseScheme: 'light', i18nKey: 'light' },
  dark: { id: 'dark', baseScheme: 'dark', i18nKey: 'dark' },
  ember: { id: 'ember', baseScheme: 'dark', i18nKey: 'ember' },
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
