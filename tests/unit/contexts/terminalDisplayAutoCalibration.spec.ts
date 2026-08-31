import { describe, expect, it, vi } from 'vitest'
import {
  createAutomaticTerminalDisplayCalibration,
  runTerminalDisplayCalibrationSingleFlight,
} from '../../../src/contexts/settings/application/terminalDisplayAutoCalibration'
import type { TerminalDisplayReference } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'

const reference: TerminalDisplayReference = {
  version: 1,
  measurement: {
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 1,
    letterSpacing: 0,
    cols: 80,
    rows: 24,
    cssCellWidth: 7.8,
    cssCellHeight: 15.6,
    effectiveDpr: 2,
    windowDevicePixelRatio: 2,
    visualViewportScale: 1,
    runtime: 'desktop',
    measuredAt: '2026-08-31T00:00:00.000Z',
  },
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    candidate: { fontSize: 13.25, lineHeight: 1, letterSpacing: 0 },
    measurement: { ...reference.measurement, measuredAt: '2026-08-31T00:00:01.000Z' },
    score: 0.5,
    ...overrides,
  }
}

describe('terminal display automatic calibration policy', () => {
  it('accepts a close candidate only when it preserves the reference grid and cell metrics', () => {
    expect(
      createAutomaticTerminalDisplayCalibration({
        profileKey: 'profile',
        reference,
        result: result(),
      }),
    ).toMatchObject({
      version: 1,
      profileKey: 'profile',
      fontSize: 13.25,
      target: { cols: 80, rows: 24 },
      measured: { cols: 80, rows: 24 },
    })
  })

  it('rejects a wrong grid, low-quality result, or excessive cell delta', () => {
    const wrongGrid = result({
      measurement: { ...reference.measurement, cols: 79 },
    })
    const lowQuality = result({ score: 101 })
    const wrongCell = result({
      measurement: { ...reference.measurement, cssCellWidth: 7.86 },
    })

    expect(
      createAutomaticTerminalDisplayCalibration({
        profileKey: 'profile',
        reference,
        result: wrongGrid,
      }),
    ).toBeNull()
    expect(
      createAutomaticTerminalDisplayCalibration({
        profileKey: 'profile',
        reference,
        result: lowQuality,
      }),
    ).toBeNull()
    expect(
      createAutomaticTerminalDisplayCalibration({
        profileKey: 'profile',
        reference,
        result: wrongCell,
      }),
    ).toBeNull()
  })

  it('shares one calibration flight for the same semantic signature', async () => {
    let resolve!: (value: number) => void
    const operation = vi.fn(
      async () =>
        await new Promise<number>(resolvePromise => {
          resolve = resolvePromise
        }),
    )

    const first = runTerminalDisplayCalibrationSingleFlight('signature', operation)
    const second = runTerminalDisplayCalibrationSingleFlight('signature', operation)
    expect(second).toBe(first)
    expect(operation).toHaveBeenCalledOnce()

    resolve(1)
    await expect(Promise.all([first, second])).resolves.toEqual([1, 1])
  })
})
