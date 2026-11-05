import {
  WINDOW_MATERIALS,
  type WindowAppearanceSettings,
  type WindowMaterial,
} from './agentSettings.types'
import { DEFAULT_AGENT_SETTINGS } from './agentSettings.defaults'
import { normalizeBoolean } from './settingsNormalization'

export function normalizeWindowAppearanceSettings(
  value: Record<string, unknown>,
): WindowAppearanceSettings {
  return {
    windowKindColorsEnabled:
      normalizeBoolean(value.windowKindColorsEnabled) ??
      DEFAULT_AGENT_SETTINGS.windowKindColorsEnabled,
    windowMaterial: (WINDOW_MATERIALS as readonly unknown[]).includes(value.windowMaterial)
      ? (value.windowMaterial as WindowMaterial)
      : DEFAULT_AGENT_SETTINGS.windowMaterial,
  }
}
