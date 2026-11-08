import type { ResolvedUiTheme } from '../../../shared/contracts/dto'

export const UI_LANGUAGES = ['en', 'zh-CN'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

/** Built-in themes in picker order: Cove dark, light, and following the system. */
export const UI_THEMES = ['dark', 'light', 'system'] as const
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
  dark: { id: 'dark', baseScheme: 'dark', terminalScheme: 'dark', i18nKey: 'dark' },
  light: { id: 'light', baseScheme: 'light', terminalScheme: 'light', i18nKey: 'light' },
  system: { id: 'system', baseScheme: 'system', terminalScheme: 'system', i18nKey: 'system' },
}

export const DEFAULT_UI_THEME: BuiltinUiTheme = 'dark'

/**
 * Retired built-in themes and the Cove theme of the same appearance that replaces them. Pixel's
 * pixel look now belongs to Cove itself (the wall, the frames, the icons), so only its palette went.
 */
export const RETIRED_UI_THEMES: Readonly<Record<string, 'dark' | 'light'>> = {
  ember: 'dark',
  'ember-light': 'light',
  pixel: 'dark',
  'pixel-light': 'light',
}

export function isBuiltinUiTheme(value: unknown): value is BuiltinUiTheme {
  return typeof value === 'string' && (UI_THEMES as readonly string[]).includes(value)
}

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en'

export function isValidUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && UI_LANGUAGES.includes(value as UiLanguage)
}

export function isValidUiTheme(value: unknown): value is UiTheme {
  return (
    typeof value === 'string' &&
    (isBuiltinUiTheme(value) || /^plugin:[a-z][a-z0-9-]{0,79}:[a-z][a-z0-9.-]{0,79}$/.test(value))
  )
}

/** A persisted theme id, with retired themes migrated; null when it is not a theme. */
export function normalizeUiTheme(value: unknown): UiTheme | null {
  if (typeof value === 'string' && Object.hasOwn(RETIRED_UI_THEMES, value)) {
    return RETIRED_UI_THEMES[value]!
  }
  return isValidUiTheme(value) ? value : null
}

export function resolveUiThemeBaseScheme(theme: UiTheme, prefersDark: boolean): ResolvedUiTheme {
  const baseScheme = (
    UI_THEME_DESCRIPTORS[theme as BuiltinUiTheme] ?? UI_THEME_DESCRIPTORS[DEFAULT_UI_THEME]
  ).baseScheme
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
