import { readThemeEffect } from '@contexts/plugins/presentation/renderer/themeMotion'

export interface PixelLayerOptions {
  background: boolean
  creation: boolean
  closing: boolean
  working: boolean
}

export const ALL_PIXEL_EFFECTS: PixelLayerOptions = {
  background: true,
  creation: true,
  closing: true,
  working: true,
}

/** User opt-outs are authoritative; a theme can only further suppress an effect. */
export function resolveThemeEffectOptions(options: PixelLayerOptions): PixelLayerOptions {
  const enabled = (name: keyof PixelLayerOptions) => {
    const effect = readThemeEffect(name)
    return options[name] && effect.preset !== 'none' && effect.durationMs !== 0
  }
  return {
    background: enabled('background'),
    creation: enabled('creation'),
    closing: enabled('closing'),
    working: enabled('working'),
  }
}
