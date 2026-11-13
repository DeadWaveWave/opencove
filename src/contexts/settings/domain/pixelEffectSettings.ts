import type { PixelEffectSettings } from './agentSettings.types'
import { normalizeCanvasBackgroundStyle } from './canvasBackgroundSettings'
import { normalizeBoolean } from './settingsNormalization'
import type { UiTheme } from './uiSettings'

export function normalizePixelEffectSettings(
  value: Record<string, unknown>,
  savedUiTheme: UiTheme | null,
): PixelEffectSettings {
  // @compat settings-legacy-fields
  // Adopt pre-toggle defaults only for missing legacy fields; explicit choices survive theme changes.
  // Before the switches existed only Pixel had effects. Unconfigured users (no saved theme) and
  // plugin themes, which postdate the switches, get the current defaults: every effect on. Pixel
  // has been retired since, so its id is read from the raw settings, before the migration.
  const legacyEnabled =
    savedUiTheme === null ||
    value.uiTheme === 'pixel' ||
    value.uiTheme === 'pixel-light' ||
    savedUiTheme.startsWith('plugin:')
  return {
    // @compat settings-legacy-fields
    canvasBackgroundStyle: normalizeCanvasBackgroundStyle(
      value.canvasBackgroundStyle,
      normalizeBoolean(value.canvasPixelBackgroundEnabled),
      legacyEnabled ? 'pixel' : 'off',
    ),
    // Ambient twinkle and cloud drift on the pixel wall; reduced motion still stops it.
    canvasBackgroundTwinkleEnabled: normalizeBoolean(value.canvasBackgroundTwinkleEnabled) ?? true,
    // @compat settings-legacy-fields
    nodeCreationPixelEffectEnabled:
      normalizeBoolean(value.nodeCreationPixelEffectEnabled) ?? legacyEnabled,
    // @compat settings-legacy-fields
    nodeClosePixelEffectEnabled:
      normalizeBoolean(value.nodeClosePixelEffectEnabled) ?? legacyEnabled,
    // @compat settings-legacy-fields
    agentWorkingPixelEffectEnabled:
      normalizeBoolean(value.agentWorkingPixelEffectEnabled) ?? legacyEnabled,
  }
}
