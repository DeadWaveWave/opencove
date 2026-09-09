import { describe, expect, it } from 'vitest'
import {
  distribution,
  readProfileConfig,
  summarizeCapture,
} from '../../../scripts/lib/canvas-window-profile-metrics.mjs'

describe('canvas window profiling evidence', () => {
  it('allows an empty-canvas control and rejects ambiguous or unbounded configurations', () => {
    expect(readProfileConfig({ OPENCOVE_PROFILE_TERMINAL_COUNT: '0' }).terminalCount).toBe(0)
    for (const value of ['-1', '10junk', '1.5', '31']) {
      expect(() => readProfileConfig({ OPENCOVE_PROFILE_TERMINAL_COUNT: value })).toThrow()
    }
    expect(() => readProfileConfig({ OPENCOVE_PROFILE_SAMPLE_DURATION_MS: '999999' })).toThrow()
    expect(() => readProfileConfig({ OPENCOVE_PROFILE_SCENARIO: 'fake-focus' })).toThrow()
  })

  it('keeps a one-second foreground stall while separating background frame suspension', () => {
    const report = summarizeCapture(
      {
        frames: [
          { deltaMs: 16, visible: true, focused: true },
          { deltaMs: 1_500, visible: true, focused: true },
          { deltaMs: 8_000, visible: false, focused: false },
          { deltaMs: 2_000, visible: true, focused: false },
        ],
        longTasks: [{ duration: 1_400 }],
        events: [{ name: 'blur', at: 123 }],
        dropped: 0,
      },
      {
        samples: [
          {
            timerDelayMs: 20,
            metrics: [{ pid: 1, type: 'Browser', cpu: { percentCPUUsage: 12 } }],
          },
        ],
        dropped: 0,
      },
    )
    expect(report.visibleFocusedFramesMs).toMatchObject({ count: 2, max: 1_500 })
    expect(report.otherFramesMs).toMatchObject({ count: 2, max: 8_000 })
    expect(report.longTasksMs.max).toBe(1_400)
    expect(report.processCpuPercent[0]).toMatchObject({ pid: 1, type: 'Browser', max: 12 })
  })

  it('reports missing observations as null rather than healthy zeroes and preserves loss counts', () => {
    expect(distribution([])).toEqual({ count: 0, p50: null, p95: null, max: null })
    const report = summarizeCapture(
      { frames: [], longTasks: [], events: [], dropped: 2 },
      { samples: [], dropped: 3 },
    )
    expect(report.visibleFocusedFramesMs.max).toBeNull()
    expect(report.lostSamples).toEqual({ renderer: 2, main: 3 })
  })
})
