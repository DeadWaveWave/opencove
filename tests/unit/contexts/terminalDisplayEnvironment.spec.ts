import { describe, expect, it } from 'vitest'
import type { TerminalDisplayReference } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import { createTerminalDisplayEnvironmentSignature } from '../../../src/contexts/settings/presentation/renderer/terminalDisplayEnvironment'

const reference: TerminalDisplayReference = {
  version: 1,
  capture: { algorithmVersion: 1, rendererKind: 'dom' },
  measurement: {
    fontSize: 13,
    fontFamily: null,
    lineHeight: 1,
    letterSpacing: 0,
    cols: 80,
    rows: 24,
    cssCellWidth: 7.8,
    cssCellHeight: 15.6,
    effectiveDpr: 1,
    windowDevicePixelRatio: 1,
    visualViewportScale: 1,
    runtime: 'browser',
    measuredAt: '2026-08-31T00:00:00.000Z',
  },
}

function signature(overrides: Record<string, unknown> = {}): string {
  return createTerminalDisplayEnvironmentSignature({
    terminalFontSize: 13,
    terminalFontFamily: null,
    reference,
    rendererKind: 'dom',
    measurement: { ...reference.measurement, ...overrides },
  })
}

describe('terminal display calibration environment signature', () => {
  it('invalidates by DPR, visual viewport, renderer, runtime, reference, and font fingerprint', () => {
    const baseline = signature()
    expect(signature({ windowDevicePixelRatio: 2 })).not.toBe(baseline)
    expect(signature({ visualViewportScale: 1.25 })).not.toBe(baseline)
    expect(signature({ runtime: 'desktop' })).not.toBe(baseline)
    expect(signature({ cssCellWidth: 7.9 })).not.toBe(baseline)
    expect(
      createTerminalDisplayEnvironmentSignature({
        terminalFontSize: 13,
        terminalFontFamily: null,
        reference,
        rendererKind: 'webgl',
        measurement: reference.measurement,
      }),
    ).not.toBe(baseline)
    expect(
      createTerminalDisplayEnvironmentSignature({
        terminalFontSize: 13,
        terminalFontFamily: null,
        reference: {
          ...reference,
          measurement: { ...reference.measurement, measuredAt: 'later-reference' },
        },
        rendererKind: 'dom',
        measurement: reference.measurement,
      }),
    ).not.toBe(baseline)
  })
})
