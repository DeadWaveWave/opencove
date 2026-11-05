import type { AgentRuntimeStatus } from '@contexts/agent/domain/types'

/** What a window's light says (Tide): derived from its state, never stored (I7). */
export type WorkLightState = 'idle' | 'standby' | 'working' | 'waiting' | 'failed'

/** Steady levels; working breathes between WORKING_MIN and WORKING_MAX. */
const LEVEL: Record<Exclude<WorkLightState, 'working'>, number> = {
  idle: 0.46,
  standby: 0.6,
  waiting: 0.78,
  failed: 0.78,
}
const WORKING_MIN = 0.64
const WORKING_MAX = 0.92
const BREATH_MS = 2600
/** Received output brightens the light for this long. */
export const WORK_LIGHT_FLASH_MS = 700
const FLASH_GAIN = 0.22
/** A finished run flares to full and settles back over this long. */
export const WORK_LIGHT_BURST_MS = 1400

export function resolveWorkLightState(
  isAgent: boolean,
  status: AgentRuntimeStatus | null,
): WorkLightState {
  if (!isAgent) {
    return 'idle'
  }
  switch (status) {
    case 'running':
    case 'restoring':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'failed'
    default:
      return 'standby'
  }
}

export interface WorkLight {
  /** 0–1: how strongly the window's colour reaches the cells around it. */
  intensity: number
  /** Kind colour, or the waiting yellow and failure red. */
  tone: 'kind' | 'waiting' | 'failed'
  /** Whether the light changes on its own, so the wall needs more frames. */
  animating: boolean
}

/**
 * The light's strength at `now` (ms), or a fixed level without a clock (reduced motion, a still
 * wall): no breathing, flash or flare. Bounded to [0, 1]; flashes and flares only decay.
 */
export function resolveWorkLight({
  state,
  now,
  outputAt,
  completedAt,
}: {
  state: WorkLightState
  now: number | null
  outputAt: number | null
  completedAt: number | null
}): WorkLight {
  const tone = state === 'waiting' ? 'waiting' : state === 'failed' ? 'failed' : 'kind'
  if (now === null) {
    const level = state === 'working' ? (WORKING_MIN + WORKING_MAX) / 2 : LEVEL[state]
    return { intensity: level, tone, animating: false }
  }
  const base =
    state === 'working'
      ? WORKING_MIN +
        (WORKING_MAX - WORKING_MIN) * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / BREATH_MS))
      : LEVEL[state]
  let intensity = base
  let animating = state === 'working'
  const sinceOutput = outputAt === null ? Infinity : now - outputAt
  if (sinceOutput >= 0 && sinceOutput <= WORK_LIGHT_FLASH_MS) {
    intensity += FLASH_GAIN * (1 - sinceOutput / WORK_LIGHT_FLASH_MS) ** 2
    animating = true
  }
  const sinceCompletion = completedAt === null ? Infinity : now - completedAt
  if (sinceCompletion >= 0 && sinceCompletion <= WORK_LIGHT_BURST_MS) {
    const flare = (1 - sinceCompletion / WORK_LIGHT_BURST_MS) ** 2
    intensity = Math.max(intensity, base + (1 - base) * flare)
    animating = true
  }
  return { intensity: Math.min(1, Math.max(0, intensity)), tone, animating }
}
