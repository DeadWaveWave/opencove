import type { PixelEffectSettings } from './agentSettings.types'
import { normalizeBoolean } from './settingsNormalization'
import type { UiTheme } from './uiSettings'

export function normalizePixelEffectSettings(
  value: Record<string, unknown>,
  uiTheme: UiTheme,
): PixelEffectSettings {
  // Adopt pre-toggle defaults only for missing legacy fields; explicit choices survive theme changes.
  const legacyEnabled = uiTheme === 'pixel' || uiTheme === 'pixel-light'
  return {
    canvasPixelBackgroundEnabled:
      normalizeBoolean(value.canvasPixelBackgroundEnabled) ?? legacyEnabled,
    nodeCreationPixelEffectEnabled:
      normalizeBoolean(value.nodeCreationPixelEffectEnabled) ?? legacyEnabled,
    nodeClosePixelEffectEnabled:
      normalizeBoolean(value.nodeClosePixelEffectEnabled) ?? legacyEnabled,
  }
}
