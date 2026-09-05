import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalDisplayReference } from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import {
  createTerminalDisplayEnvironmentSignature,
  readTerminalDisplayEnvironmentObservation,
} from '../../../src/contexts/settings/presentation/renderer/terminalDisplayEnvironment'

const inventory = vi.hoisted(() => vi.fn(() => ({ dom: 0, webgl: 1 })))
vi.mock(
  '../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement')
    >()),
    resolveMountedTerminalDisplayRendererInventory: inventory,
  }),
)

afterEach(() => vi.unstubAllGlobals())

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
  it('observes renderer compatibility without treating sibling counts as an environment change', () => {
    inventory.mockReturnValue({ dom: 0, webgl: 1 })
    const first = readTerminalDisplayEnvironmentObservation()
    inventory.mockReturnValue({ dom: 0, webgl: 8 })
    expect(readTerminalDisplayEnvironmentObservation()).toEqual(first)
    inventory.mockReturnValue({ dom: 1, webgl: 8 })
    expect(readTerminalDisplayEnvironmentObservation().rendererKind).toBe('mixed')
    inventory.mockReturnValue({ dom: 1, webgl: 0 })
    expect(readTerminalDisplayEnvironmentObservation().rendererKind).toBe('dom')
    inventory.mockReturnValue({ dom: 0, webgl: 0 })
    expect(readTerminalDisplayEnvironmentObservation().rendererKind).toBe('none')
  })

  it('observes device and visual viewport scale changes synchronously', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('visualViewport', { scale: 1 })
    const first = readTerminalDisplayEnvironmentObservation()
    vi.stubGlobal('devicePixelRatio', 1.5)
    expect(readTerminalDisplayEnvironmentObservation()).not.toEqual(first)
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal('visualViewport', { scale: 1.25 })
    expect(readTerminalDisplayEnvironmentObservation()).not.toEqual(first)
  })

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
