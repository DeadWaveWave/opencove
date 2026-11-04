import type { WindowAppearanceSettings } from './agentSettings.types'
import { DEFAULT_AGENT_SETTINGS } from './agentSettings.defaults'
import { normalizeBoolean } from './settingsNormalization'

export function normalizeWindowAppearanceSettings(
  value: Record<string, unknown>,
): WindowAppearanceSettings {
  return {
    windowKindColorsEnabled:
      normalizeBoolean(value.windowKindColorsEnabled) ??
      DEFAULT_AGENT_SETTINGS.windowKindColorsEnabled,
    reduceTransparency:
      normalizeBoolean(value.reduceTransparency) ?? DEFAULT_AGENT_SETTINGS.reduceTransparency,
  }
}
