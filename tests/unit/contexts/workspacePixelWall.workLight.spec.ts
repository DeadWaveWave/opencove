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
) => resolveWorkLight({ state, now, outputAt: null, flashAt: null, ...extra })

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

  it('matches the per-window working phase and the waiting beacon clock', () => {
    for (const now of [0, 300, 600, 1200, 1800, 2400]) {
      for (const seed of [0, 0.3, 0.9]) {
        expect(at('working', now, { seed }).intensity).toBeCloseTo(
          0.78 + 0.14 * Math.sin((2 * Math.PI * now) / 2400 + seed * 6),
          10,
        )
      }
      expect(at('waiting', now).intensity).toBeCloseTo(
        0.7 + 0.3 * (0.5 + 0.5 * Math.sin((2 * Math.PI * now) / 1300)),
        10,
      )
    }
    expect(at('waiting', 0).animating).toBe(true)
    expect(at('failed', 0).intensity).toBe(0.9)
  })

  it('adds exponential output energy and quadratic completion or failure energy', () => {
    for (const elapsed of [0, 260, 520, 1040, 1500]) {
      expect(at('idle', 1000 + elapsed, { outputAt: 1000 }).intensity).toBeCloseTo(
        0.46 + 0.38 * Math.exp(-elapsed / 520),
        10,
      )
    }
    expect(at('standby', 1750, { flashAt: 1000 }).intensity).toBeCloseTo(0.825)
    expect(at('failed', 2250, { flashAt: 1000 }).intensity).toBeCloseTo(0.925)
  })

  it('fades new light in over 700ms, but calm mode has no energy or fade', () => {
    expect(at('idle', 1000, { bornAt: 1000 }).intensity).toBe(0)
    expect(at('idle', 1350, { bornAt: 1000 }).intensity).toBeCloseTo(0.23)
    expect(at('idle', 1700, { bornAt: 1000 })).toMatchObject({ intensity: 0.46, animating: false })
    expect(at('working', null, { outputAt: 0, flashAt: 0, bornAt: 0 })).toMatchObject({
      intensity: 0.8,
      animating: false,
    })
    expect(at('waiting', null, { outputAt: 0, flashAt: 0, bornAt: 0 })).toMatchObject({
      intensity: 0.85,
      animating: false,
    })
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
    const flashAt = 5_000
    expect(at('standby', flashAt, { flashAt }).intensity).toBeCloseTo(1)
    let previous = Infinity
    for (let elapsed = 0; elapsed <= WORK_LIGHT_BURST_MS + 100; elapsed += 30) {
      const light = at('standby', flashAt + elapsed, { flashAt })
      expect(light.intensity).toBeLessThanOrEqual(previous + 1e-9)
      expect(light.intensity).toBeGreaterThanOrEqual(0.6 - 1e-9)
      previous = light.intensity
    }
    expect(at('standby', flashAt + WORK_LIGHT_BURST_MS + 1, { flashAt }).animating).toBe(false)
  })

  it('stays within [0, 1] for every state and moment', () => {
    for (const state of ['idle', 'standby', 'working', 'waiting', 'failed'] as const) {
      for (let now = 0; now < 4000; now += 37) {
        const { intensity } = at(state, now, { outputAt: now - 5, flashAt: now - 9 })
        expect(intensity).toBeGreaterThanOrEqual(0)
        expect(intensity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('holds a fixed level without a clock: no breathing, flash or flare under reduced motion', () => {
    const still = at('working', null, { outputAt: 0, flashAt: 0 })
    expect(still.animating).toBe(false)
    expect(still.intensity).toBeGreaterThanOrEqual(0.64)
    expect(still.intensity).toBeLessThanOrEqual(0.92)
    expect(at('standby', null, { flashAt: 0 }).intensity).toBeCloseTo(0.6)
  })
})
