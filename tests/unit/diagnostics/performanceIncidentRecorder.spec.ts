import { describe, expect, it } from 'vitest'
import { resolvePerformanceIncidentTrigger } from '../../../src/app/renderer/performanceDiagnostics/performanceIncidentRecorder'

const baseFrames = {
  sampleCount: 120,
  frameP95Ms: 12,
  frameMaxMs: 20,
  longTaskCount: 0,
  longTaskTotalMs: 0,
}

const baseMemoryTrend = {
  sampleCount: 30,
  durationMs: 30_000,
  baselineJsHeapUsedBytes: 100,
  currentJsHeapUsedBytes: 100,
  deltaJsHeapUsedBytes: 0,
  deltaPercent: 0,
  isGrowing: false,
}

describe('performance incident recorder', () => {
  it('records frame jank after the cooldown window', () => {
    expect(
      resolvePerformanceIncidentTrigger({
        status: 'janky',
        frames: { ...baseFrames, frameP95Ms: 40 },
        memoryTrend: baseMemoryTrend,
        previousLongTaskCount: 0,
        previousLongTaskTotalMs: 0,
        lastRecordedAtMs: 1_000,
        nowMs: 20_000,
        cooldownMs: 15_000,
      }),
    ).toBe('frameJank')
  })

  it('does not record repeated incidents during cooldown', () => {
    expect(
      resolvePerformanceIncidentTrigger({
        status: 'janky',
        frames: { ...baseFrames, frameP95Ms: 40 },
        memoryTrend: baseMemoryTrend,
        previousLongTaskCount: 0,
        previousLongTaskTotalMs: 0,
        lastRecordedAtMs: 10_000,
        nowMs: 20_000,
        cooldownMs: 15_000,
      }),
    ).toBeNull()
  })

  it('records new long tasks even when frame p95 is normal', () => {
    expect(
      resolvePerformanceIncidentTrigger({
        status: 'normal',
        frames: { ...baseFrames, longTaskCount: 1, longTaskTotalMs: 80 },
        memoryTrend: baseMemoryTrend,
        previousLongTaskCount: 0,
        previousLongTaskTotalMs: 0,
        lastRecordedAtMs: 0,
        nowMs: 20_000,
        cooldownMs: 15_000,
      }),
    ).toBe('longTask')
  })
})
