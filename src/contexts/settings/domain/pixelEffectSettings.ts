import type { PixelEffectSettings } from './agentSettings.types'
import { normalizeBoolean } from './settingsNormalization'
import type { UiTheme } from './uiSettings'

export function normalizePixelEffectSettings(
  value: Record<string, unknown>,
  uiTheme: UiTheme,
): PixelEffectSettings {
  // Adopt pre-toggle defaults only for missing legacy fields; explicit choices survive theme changes.
  // Plugin themes postdate effect switches; missing fields use current defaults,
  // without consulting an installed plugin or changing explicit user choices.
  const legacyEnabled =
    uiTheme === 'pixel' || uiTheme === 'pixel-light' || uiTheme.startsWith('plugin:')
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
