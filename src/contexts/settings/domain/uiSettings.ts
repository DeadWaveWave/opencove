import type { ResolvedUiTheme } from '../../../shared/contracts/dto'

export const UI_LANGUAGES = ['en', 'zh-CN'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

/** Built-in themes in picker order. `dark`, `light` and `system` are the Cove family's ids. */
export const UI_THEMES = ['dark', 'light', 'system', 'pixel', 'pixel-light'] as const
export type BuiltinUiTheme = (typeof UI_THEMES)[number]
export type PluginUiTheme = `plugin:${string}:${string}`
export type UiTheme = BuiltinUiTheme | PluginUiTheme

export type UiThemeBaseScheme = ResolvedUiTheme | 'system'
/** Cove is generated (`src/shared/design`); Pixel is hand-written. */
export type UiThemeFamily = 'cove' | 'pixel'

export interface UiThemeDescriptor {
  id: UiTheme
  family: UiThemeFamily
  baseScheme: UiThemeBaseScheme
  terminalScheme: UiThemeBaseScheme
  i18nKey: string
}

export const UI_THEME_DESCRIPTORS: Record<BuiltinUiTheme, UiThemeDescriptor> = {
  dark: { id: 'dark', family: 'cove', baseScheme: 'dark', terminalScheme: 'dark', i18nKey: 'dark' },
  light: {
    id: 'light',
    family: 'cove',
    baseScheme: 'light',
    terminalScheme: 'light',
    i18nKey: 'light',
  },
  system: {
    id: 'system',
    family: 'cove',
    baseScheme: 'system',
    terminalScheme: 'system',
    i18nKey: 'system',
  },
  pixel: {
    id: 'pixel',
    family: 'pixel',
    baseScheme: 'dark',
    terminalScheme: 'dark',
    i18nKey: 'pixel',
  },
  'pixel-light': {
    id: 'pixel-light',
    family: 'pixel',
    baseScheme: 'light',
    terminalScheme: 'light',
    i18nKey: 'pixelLight',
  },
}

export const DEFAULT_UI_THEME: BuiltinUiTheme = 'dark'

/** Retired built-in themes and the Cove theme of the same appearance that replaces them. */
export const RETIRED_UI_THEMES: Readonly<Record<string, 'dark' | 'light'>> = {
  ember: 'dark',
  'ember-light': 'light',
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
