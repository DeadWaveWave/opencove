import type { AgentRuntimeStatus } from '@contexts/agent/domain/types'

/** What a window's light says (Tide): derived from its state, never stored (I7). */
export type WorkLightState = 'idle' | 'standby' | 'working' | 'waiting' | 'failed'

const LEVEL = { idle: 0.46, standby: 0.6, waiting: 0.85, failed: 0.9 }
/** Output energy stops requesting frames once its contribution is below 0.01 (Tide nodeLight). */
export const WORK_LIGHT_FLASH_MS = 520 * Math.log(38)
export const WORK_LIGHT_BURST_MS = 1500
const BIRTH_MS = 700

/** Stable across remeasurement and reload; windows breathe with their own phase. */
export function workLightSeed(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619)
  }
  return (hash >>> 0) / 4294967296
}

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
  flashAt,
  bornAt = null,
  seed = 0,
}: {
  state: WorkLightState
  now: number | null
  outputAt: number | null
  flashAt: number | null
  bornAt?: number | null
  seed?: number
}): WorkLight {
  const tone = state === 'waiting' ? 'waiting' : state === 'failed' ? 'failed' : 'kind'
  if (now === null) {
    return { intensity: state === 'working' ? 0.8 : LEVEL[state], tone, animating: false }
  }
  let intensity =
    state === 'working'
      ? 0.78 + 0.14 * Math.sin((2 * Math.PI * now) / 2400 + seed * 6)
      : state === 'waiting'
        ? 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((2 * Math.PI * now) / 1300))
        : LEVEL[state]
  let animating = state === 'working' || state === 'waiting'
  const sinceOutput = outputAt === null ? Infinity : now - outputAt
  if (sinceOutput >= 0 && sinceOutput < WORK_LIGHT_FLASH_MS) {
    intensity += 0.38 * Math.exp(-sinceOutput / 520)
    animating = true
  }
  const sinceFlash = flashAt === null ? Infinity : now - flashAt
  if (sinceFlash >= 0 && sinceFlash < WORK_LIGHT_BURST_MS) {
    intensity += 0.9 * (1 - sinceFlash / WORK_LIGHT_BURST_MS) ** 2
    animating = true
  }
  if (bornAt !== null && now - bornAt < BIRTH_MS) {
    intensity *= Math.max(0, (now - bornAt) / BIRTH_MS)
    animating = true
  }
  return { intensity: Math.min(1, Math.max(0, intensity)), tone, animating }
}
