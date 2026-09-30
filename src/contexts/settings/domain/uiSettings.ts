import type { ResolvedUiTheme } from '../../../shared/contracts/dto'

export const UI_LANGUAGES = ['en', 'zh-CN'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

export const UI_THEMES = [
  'system',
  'light',
  'dark',
  'ember',
  'ember-light',
  'pixel',
  'pixel-light',
] as const
export type BuiltinUiTheme = (typeof UI_THEMES)[number]
export type PluginUiTheme = `plugin:${string}:${string}`
export type UiTheme = BuiltinUiTheme | PluginUiTheme

export type UiThemeBaseScheme = ResolvedUiTheme | 'system'

export interface UiThemeDescriptor {
  id: UiTheme
  baseScheme: UiThemeBaseScheme
  terminalScheme: UiThemeBaseScheme
  i18nKey: string
}

export const UI_THEME_DESCRIPTORS: Record<BuiltinUiTheme, UiThemeDescriptor> = {
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
  pixel: { id: 'pixel', baseScheme: 'dark', terminalScheme: 'dark', i18nKey: 'pixel' },
  'pixel-light': {
    id: 'pixel-light',
    baseScheme: 'light',
    terminalScheme: 'light',
    i18nKey: 'pixelLight',
  },
}

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en'

export function isValidUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && UI_LANGUAGES.includes(value as UiLanguage)
}

export function isValidUiTheme(value: unknown): value is UiTheme {
  return (
    typeof value === 'string' &&
    ((UI_THEMES as readonly string[]).includes(value) ||
      /^plugin:[a-z][a-z0-9-]{0,79}:[a-z][a-z0-9.-]{0,79}$/.test(value))
  )
}

export function resolveUiThemeBaseScheme(theme: UiTheme, prefersDark: boolean): ResolvedUiTheme {
  const baseScheme = (UI_THEME_DESCRIPTORS[theme as BuiltinUiTheme] ?? UI_THEME_DESCRIPTORS.pixel)
    .baseScheme
  if (baseScheme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return baseScheme
}

export function resolveUiThemeTerminalScheme(
  theme: UiTheme,
  resolvedBaseScheme: ResolvedUiTheme,
): ResolvedUiTheme {
  const terminalScheme =
    UI_THEME_DESCRIPTORS[theme as BuiltinUiTheme]?.terminalScheme ?? resolvedBaseScheme
  return terminalScheme === 'system' ? resolvedBaseScheme : terminalScheme
}
