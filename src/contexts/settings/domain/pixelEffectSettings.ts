import type { PixelEffectSettings } from './agentSettings.types'
import { normalizeBoolean } from './settingsNormalization'
import type { UiTheme } from './uiSettings'

export function normalizePixelEffectSettings(
  value: Record<string, unknown>,
  savedUiTheme: UiTheme | null,
): PixelEffectSettings {
  // Adopt pre-toggle defaults only for missing legacy fields; explicit choices survive theme changes.
  // Before the switches existed only Pixel had effects. Unconfigured users (no saved theme) and
  // plugin themes, which postdate the switches, get the current defaults: every effect on.
  const legacyEnabled =
    savedUiTheme === null ||
    savedUiTheme === 'pixel' ||
    savedUiTheme === 'pixel-light' ||
    savedUiTheme.startsWith('plugin:')
  return {
    canvasPixelBackgroundEnabled:
      normalizeBoolean(value.canvasPixelBackgroundEnabled) ?? legacyEnabled,
    nodeCreationPixelEffectEnabled:
      normalizeBoolean(value.nodeCreationPixelEffectEnabled) ?? legacyEnabled,
    nodeClosePixelEffectEnabled:
      normalizeBoolean(value.nodeClosePixelEffectEnabled) ?? legacyEnabled,
    agentWorkingPixelEffectEnabled:
      normalizeBoolean(value.agentWorkingPixelEffectEnabled) ?? legacyEnabled,
  }
}
