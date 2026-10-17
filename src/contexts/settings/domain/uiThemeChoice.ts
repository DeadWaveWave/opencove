import {
  UI_THEME_DESCRIPTORS,
  UI_THEMES,
  type BuiltinUiTheme,
  type UiTheme,
  type UiThemeFamily,
} from './uiSettings'

/** The control center picks a theme as a family plus a light/dark/system mode. */
export type UiThemeMode = 'light' | 'dark' | 'system'

export function uiThemeModesFor(family: UiThemeFamily): UiThemeMode[] {
  return UI_THEMES.some(
    theme =>
      UI_THEME_DESCRIPTORS[theme].family === family &&
      UI_THEME_DESCRIPTORS[theme].baseScheme === 'system',
  )
    ? ['light', 'dark', 'system']
    : ['light', 'dark']
}

/** Plugin themes have no family or mode here; they are chosen in Settings. */
export function describeUiThemeChoice(theme: UiTheme): {
  family: UiThemeFamily | null
  mode: UiThemeMode | null
} {
  const descriptor = UI_THEME_DESCRIPTORS[theme as BuiltinUiTheme]
  return descriptor
    ? { family: descriptor.family, mode: descriptor.baseScheme }
    : { family: null, mode: null }
}

/** A family without a system mode keeps whatever the system shows now. */
export function resolveUiThemeChoice(
  family: UiThemeFamily,
  mode: UiThemeMode,
  prefersDark: boolean,
): BuiltinUiTheme {
  const effectiveMode =
    mode === 'system' && !uiThemeModesFor(family).includes('system')
      ? prefersDark
        ? 'dark'
        : 'light'
      : mode
  const match = UI_THEMES.find(
    theme =>
      UI_THEME_DESCRIPTORS[theme].family === family &&
      UI_THEME_DESCRIPTORS[theme].baseScheme === effectiveMode,
  )
  return match ?? UI_THEMES[0]
}
