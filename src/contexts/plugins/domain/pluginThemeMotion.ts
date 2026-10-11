/** Theme motion describes presentation only; layout and node lifetime remain host-owned. */
export interface PluginThemeKeyframe {
  offset?: number
  opacity?: number
  transform?: string
  filter?: string
  clipPath?: string
}

export interface PluginThemeTransition {
  durationMs?: number
  easing?: string
}

export interface PluginThemeEffect extends PluginThemeTransition {
  preset: 'pixel' | 'custom' | 'none'
  keyframes?: PluginThemeKeyframe[]
}

export interface PluginThemeMotion {
  background?: PluginThemeEffect
  creation?: PluginThemeEffect
  closing?: PluginThemeEffect
  working?: PluginThemeEffect
  fold?: PluginThemeTransition
  unfold?: PluginThemeTransition
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid theme motion declaration.')
  }
  return value as Record<string, unknown>
}

function easing(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || value.length > 120) {
    throw new Error('Invalid theme motion easing.')
  }
  const text = value.trim()
  if (/^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(text)) {
    return text
  }
  const cubic =
    /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(text)
  if (cubic) {
    const numbers = cubic.slice(1).map(Number)
    if (
      numbers.every(Number.isFinite) &&
      numbers[0] >= 0 &&
      numbers[0] <= 1 &&
      numbers[2] >= 0 &&
      numbers[2] <= 1
    ) {
      return text
    }
  }
  const steps =
    /^steps\(\s*([1-9]\d{0,2})\s*(?:,\s*(start|end|jump-start|jump-end|jump-none|jump-both)\s*)?\)$/.exec(
      text,
    )
  if (steps && (steps[2] !== 'jump-none' || Number(steps[1]) > 1)) {
    return text
  }
  throw new Error('Invalid theme motion easing.')
}

function transition(raw: Record<string, unknown>, maximum: number): PluginThemeTransition {
  const duration = raw.durationMs
  if (
    duration !== undefined &&
    (typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > maximum)
  ) {
    throw new Error('Invalid theme motion duration.')
  }
  return {
    ...(duration === undefined ? {} : { durationMs: duration as number }),
    ...(raw.easing === undefined ? {} : { easing: easing(raw.easing) }),
  }
}

function keyframes(value: unknown): PluginThemeKeyframe[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) {
    throw new Error('Theme motion requires 2–16 keyframes.')
  }
  let lastOffset = 0
  return value.map(item => {
    const raw = record(item)
    const frame: PluginThemeKeyframe = {}
    for (const [property, input] of Object.entries(raw)) {
      if (property === 'offset' || property === 'opacity') {
        if (
          typeof input !== 'number' ||
          !Number.isFinite(input) ||
          input < 0 ||
          input > 1 ||
          (property === 'offset' && input < lastOffset)
        ) {
          throw new Error('Invalid theme motion keyframe number.')
        }
        frame[property] = input
        if (property === 'offset') {
          lastOffset = input
        }
      } else if (property === 'transform' || property === 'filter' || property === 'clipPath') {
        if (
          typeof input !== 'string' ||
          !input.trim() ||
          input.length > 500 ||
          /[;{}<>]|url\s*\(/i.test(input)
        ) {
          throw new Error('Invalid theme motion keyframe style.')
        }
        frame[property] = input.trim()
      } else {
        throw new Error(`Unsupported theme motion property: ${property}`)
      }
    }
    return frame
  })
}

export function normalizePluginThemeMotion(value: unknown): PluginThemeMotion | undefined {
  if (value === undefined) {
    return undefined
  }
  const raw = record(value)
  const motion: PluginThemeMotion = {}
  for (const [name, input] of Object.entries(raw)) {
    const item = record(input)
    if (name === 'fold' || name === 'unfold') {
      motion[name] = transition(item, 2000)
    } else if (
      name === 'background' ||
      name === 'creation' ||
      name === 'closing' ||
      name === 'working'
    ) {
      if (item.preset !== 'pixel' && item.preset !== 'custom' && item.preset !== 'none') {
        throw new Error('Invalid theme motion preset.')
      }
      if (item.preset !== 'custom' && (item.easing !== undefined || item.keyframes !== undefined)) {
        throw new Error('Theme keyframes and easing require the custom motion preset.')
      }
      motion[name] = {
        preset: item.preset,
        ...transition(item, name === 'background' || name === 'working' ? 60000 : 2000),
        ...(item.keyframes === undefined ? {} : { keyframes: keyframes(item.keyframes) }),
      }
    } else {
      throw new Error(`Unsupported theme motion slot: ${name}`)
    }
  }
  return motion
}
