import type { PluginThemeEffect, PluginThemeMotion } from '../../domain/pluginThemeMotion'

const listeners = new Set<() => void>()
let current: PluginThemeMotion = {}
let generation = 0

/** Applied theme is a view-local projection, never a persisted motion preference. */
export function applyThemeMotion(motion: PluginThemeMotion = {}): () => void {
  const ownedGeneration = ++generation
  current = motion
  listeners.forEach(listener => listener())
  return () => {
    if (ownedGeneration !== generation) {
      return
    }
    current = {}
    generation++
    listeners.forEach(listener => listener())
  }
}

export function readThemeMotion(): PluginThemeMotion {
  return current
}

export function subscribeThemeMotion(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readThemeEffect(
  name: 'background' | 'creation' | 'closing' | 'working',
): PluginThemeEffect {
  return current[name] ?? { preset: 'pixel' }
}

export function readThemeTransition(name: 'fold' | 'unfold') {
  return {
    durationMs: current[name]?.durationMs ?? (name === 'fold' ? 280 : 360),
    easing: current[name]?.easing ?? 'cubic-bezier(0.22, 1, 0.36, 1)',
  }
}
