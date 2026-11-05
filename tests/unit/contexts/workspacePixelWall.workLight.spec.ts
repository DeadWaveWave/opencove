import { describe, expect, it } from 'vitest'
import {
  resolveWorkLight,
  resolveWorkLightState,
  WORK_LIGHT_BURST_MS,
  WORK_LIGHT_FLASH_MS,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/workLight'

const at = (
  state: Parameters<typeof resolveWorkLight>[0]['state'],
  now: number | null,
  extra = {},
) => resolveWorkLight({ state, now, outputAt: null, completedAt: null, ...extra })

describe('work light', () => {
  it('maps agent status to a light state, with non-agent windows idle', () => {
    expect(resolveWorkLightState(false, null)).toBe('idle')
    expect(resolveWorkLightState(true, 'running')).toBe('working')
    expect(resolveWorkLightState(true, 'restoring')).toBe('working')
    expect(resolveWorkLightState(true, 'waiting')).toBe('waiting')
    expect(resolveWorkLightState(true, 'failed')).toBe('failed')
    for (const status of ['standby', 'exited', 'stopped', null] as const) {
      expect(resolveWorkLightState(true, status)).toBe('standby')
    }
  })

  it('holds idle at 0.46 and standby at 0.6, and breathes working between 0.64 and 0.92', () => {
    expect(at('idle', 1000).intensity).toBeCloseTo(0.46)
    expect(at('standby', 1000).intensity).toBeCloseTo(0.6)
    const samples = Array.from({ length: 400 }, (_, index) => at('working', index * 25).intensity)
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.64 - 1e-9)
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.92 + 1e-9)
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.25)
    expect(at('working', 1000).animating).toBe(true)
    expect(at('standby', 1000).animating).toBe(false)
  })

  it('tints waiting yellow and failure red, and the rest by the window kind', () => {
    expect(at('waiting', 0).tone).toBe('waiting')
    expect(at('failed', 0).tone).toBe('failed')
    expect(at('working', 0).tone).toBe('kind')
    expect(at('idle', 0).tone).toBe('kind')
  })

  it('brightens on output and the flash decays monotonically back to the state level', () => {
    const outputAt = 10_000
    let previous = Infinity
    for (let elapsed = 0; elapsed <= WORK_LIGHT_FLASH_MS + 100; elapsed += 20) {
      const light = at('standby', outputAt + elapsed, { outputAt })
      expect(light.intensity).toBeLessThanOrEqual(previous + 1e-9)
      expect(light.intensity).toBeLessThanOrEqual(1)
      previous = light.intensity
    }
    expect(at('standby', outputAt, { outputAt }).intensity).toBeGreaterThan(0.6)
    expect(at('standby', outputAt + WORK_LIGHT_FLASH_MS + 1, { outputAt }).intensity).toBeCloseTo(
      0.6,
    )
    expect(at('standby', outputAt + 100, { outputAt }).animating).toBe(true)
  })

  it('flares to full on completion and settles monotonically to standby', () => {
    const completedAt = 5_000
    expect(at('standby', completedAt, { completedAt }).intensity).toBeCloseTo(1)
    let previous = Infinity
    for (let elapsed = 0; elapsed <= WORK_LIGHT_BURST_MS + 100; elapsed += 30) {
      const light = at('standby', completedAt + elapsed, { completedAt })
      expect(light.intensity).toBeLessThanOrEqual(previous + 1e-9)
      expect(light.intensity).toBeGreaterThanOrEqual(0.6 - 1e-9)
      previous = light.intensity
    }
    expect(at('standby', completedAt + WORK_LIGHT_BURST_MS + 1, { completedAt }).animating).toBe(
      false,
    )
  })

  it('stays within [0, 1] for every state and moment', () => {
    for (const state of ['idle', 'standby', 'working', 'waiting', 'failed'] as const) {
      for (let now = 0; now < 4000; now += 37) {
        const { intensity } = at(state, now, { outputAt: now - 5, completedAt: now - 9 })
        expect(intensity).toBeGreaterThanOrEqual(0)
        expect(intensity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('holds a fixed level without a clock: no breathing, flash or flare under reduced motion', () => {
    const still = at('working', null, { outputAt: 0, completedAt: 0 })
    expect(still.animating).toBe(false)
    expect(still.intensity).toBeGreaterThanOrEqual(0.64)
    expect(still.intensity).toBeLessThanOrEqual(0.92)
    expect(at('standby', null, { completedAt: 0 }).intensity).toBeCloseTo(0.6)
  })
})
