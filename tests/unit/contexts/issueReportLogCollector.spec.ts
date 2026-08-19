import { describe, expect, it } from 'vitest'
import { sampleLogLinesByEventType } from '../../../src/contexts/issueReport/infrastructure/main/issueReportLogCollector'

describe('issue report log collector', () => {
  it('reserves samples for distinct event types before filling from the tail', () => {
    const rare = JSON.stringify({ source: 'main-app', event: 'window-resize', message: 'rare' })
    const noise = Array.from({ length: 80 }, (_, index) =>
      JSON.stringify({
        source: 'renderer-performance-monitor',
        event: 'slow-frame',
        message: `noise-${index}-${'x'.repeat(80)}`,
      }),
    )

    const sampled = sampleLogLinesByEventType([rare, ...noise].join('\n'), 1_200)

    expect(sampled).toContain('"event":"window-resize"')
    expect(sampled).toContain('noise-79')
    expect(Buffer.byteLength(sampled, 'utf8')).toBeLessThanOrEqual(1_200)
  })
})
