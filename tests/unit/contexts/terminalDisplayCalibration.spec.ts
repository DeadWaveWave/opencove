import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTerminalDisplayProfileKey,
  createTerminalDisplayReferenceSignature,
  getTerminalDisplayCalibrationQuality,
  isTerminalDisplayCalibrationHighConfidence,
  isTerminalDisplayReferenceCurrent,
  normalizeTerminalClientDisplayCalibration,
  normalizeTerminalDisplayReference,
  resolveTerminalDisplayCalibrationCompensation,
} from '../../../src/contexts/settings/domain/terminalDisplayCalibration'
import {
  clearTerminalClientDisplayCalibration,
  inspectTerminalClientDisplayCalibration,
  readStoredTerminalDisplayCalibration,
  writeTerminalClientDisplayCalibration,
} from '../../../src/contexts/settings/presentation/renderer/terminalDisplayCalibrationStorage'
import { buildTerminalDisplayCalibrationCandidates } from '../../../src/contexts/settings/presentation/renderer/terminalDisplayMeasurement'

describe('terminal display calibration state', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps a legacy shared reference readable but not current for calibration', () => {
    const reference = normalizeTerminalDisplayReference({
      version: 1,
      measurement: {
        fontSize: 13,
        fontFamily: '',
        lineHeight: 1,
        letterSpacing: 0,
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
        windowDevicePixelRatio: 1,
        visualViewportScale: 1,
        runtime: 'browser',
        measuredAt: '2026-04-29T00:00:00.000Z',
      },
    })

    expect(reference).toMatchObject({
      version: 1,
      measurement: {
        fontFamily: null,
        cols: 81,
        rows: 24,
        runtime: 'browser',
      },
    })
    expect(isTerminalDisplayReferenceCurrent(reference)).toBe(false)
  })

  it('normalizes capture provenance for a current shared reference', () => {
    const reference = normalizeTerminalDisplayReference({
      version: 1,
      capture: { algorithmVersion: 1, rendererKind: 'webgl' },
      measurement: {
        fontSize: 13,
        fontFamily: null,
        lineHeight: 1,
        letterSpacing: 0,
        cols: 82,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
        windowDevicePixelRatio: 2,
        visualViewportScale: 1,
        runtime: 'desktop',
        measuredAt: '2026-09-01T00:00:00.000Z',
      },
    })

    expect(reference).toMatchObject({
      capture: { algorithmVersion: 1, rendererKind: 'webgl' },
    })
    expect(isTerminalDisplayReferenceCurrent(reference)).toBe(true)
  })

  it('creates a property-order-independent reference signature', () => {
    const measurement = {
      fontSize: 13,
      fontFamily: null,
      lineHeight: 1,
      letterSpacing: 0,
      cols: 82,
      rows: 24,
      cssCellWidth: 7.5,
      cssCellHeight: 15,
      effectiveDpr: 2,
      windowDevicePixelRatio: 2,
      visualViewportScale: 1,
      runtime: 'desktop' as const,
      measuredAt: '2026-09-01T00:00:00.000Z',
    }
    const capture = { algorithmVersion: 1 as const, rendererKind: 'webgl' as const }

    expect(createTerminalDisplayReferenceSignature({ version: 1, capture, measurement })).toBe(
      createTerminalDisplayReferenceSignature({ version: 1, measurement, capture }),
    )
  })

  it('maps engineering scores to user-facing match quality', () => {
    expect(getTerminalDisplayCalibrationQuality(0)).toBe('exact')
    expect(getTerminalDisplayCalibrationQuality(50)).toBe('close')
    expect(getTerminalDisplayCalibrationQuality(1000)).toBe('needsAdjustment')
    expect(getTerminalDisplayCalibrationQuality(Number.NaN)).toBe('needsAdjustment')
  })

  it('keeps display calibration candidates on the default terminal line height', () => {
    const candidates = buildTerminalDisplayCalibrationCandidates(13)

    expect(new Set(candidates.map(candidate => candidate.lineHeight))).toEqual(new Set([1]))
  })

  it('keeps saved display compensation gated by the user setting', () => {
    const calibration = normalizeTerminalClientDisplayCalibration({
      version: 1,
      profileKey: createTerminalDisplayProfileKey({
        terminalFontSize: 13,
        terminalFontFamily: null,
      }),
      fontSize: 12.5,
      lineHeight: 1,
      letterSpacing: 0,
      target: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      measured: {
        cols: 78,
        rows: 23,
        cssCellWidth: 7.75,
        cssCellHeight: 15.5,
        effectiveDpr: 2,
      },
      score: 0,
      measuredAt: '2026-04-29T00:00:00.000Z',
    })

    expect(calibration).not.toBeNull()
    expect(calibration).toMatchObject({
      measured: {
        cols: 78,
        rows: 23,
        cssCellWidth: 7.75,
        cssCellHeight: 15.5,
        effectiveDpr: 2,
      },
    })
    expect(
      resolveTerminalDisplayCalibrationCompensation({
        calibration,
        compensationEnabled: true,
      }),
    ).toBe(calibration)
    expect(
      resolveTerminalDisplayCalibrationCompensation({
        calibration,
        compensationEnabled: false,
      }),
    ).toBeNull()
  })

  it('normalizes legacy saved display compensation back to the default line height', () => {
    const calibration = normalizeTerminalClientDisplayCalibration({
      version: 1,
      profileKey: createTerminalDisplayProfileKey({
        terminalFontSize: 13,
        terminalFontFamily: null,
      }),
      fontSize: 12.5,
      lineHeight: 1.1,
      letterSpacing: 0,
      target: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      score: 0,
      measuredAt: '2026-04-29T00:00:00.000Z',
    })

    expect(calibration).toMatchObject({
      fontSize: 12.5,
      lineHeight: 1,
      letterSpacing: 0,
    })
    expect(isTerminalDisplayCalibrationHighConfidence(calibration!)).toBe(false)
  })

  it('keeps client calibration scoped to the matching terminal appearance profile', () => {
    const profileKey = createTerminalDisplayProfileKey({
      terminalFontSize: 13,
      terminalFontFamily: null,
    })
    const reference = normalizeTerminalDisplayReference({
      version: 1,
      capture: { algorithmVersion: 1, rendererKind: 'webgl' },
      measurement: {
        fontSize: 13,
        fontFamily: null,
        lineHeight: 1,
        letterSpacing: 0,
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
        windowDevicePixelRatio: 1,
        visualViewportScale: 1,
        runtime: 'desktop',
        measuredAt: '2026-04-29T00:00:00.000Z',
      },
    })
    const calibration = normalizeTerminalClientDisplayCalibration({
      version: 1,
      profileKey,
      fontSize: 12.5,
      lineHeight: 1,
      letterSpacing: 0,
      target: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      measured: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      score: 0,
      measuredAt: '2026-04-29T00:00:00.000Z',
    })

    expect(calibration).not.toBeNull()
    expect(reference).not.toBeNull()
    writeTerminalClientDisplayCalibration(calibration!)

    expect(
      inspectTerminalClientDisplayCalibration({
        terminalFontSize: 13,
        terminalFontFamily: null,
        terminalDisplayReference: reference,
      }),
    ).toMatchObject({
      calibrationFontSize: 12.5,
      profileMatches: true,
      calibrationMatchesReference: true,
      atomicProofPresent: false,
      applicableCalibrationPresent: false,
    })
    expect(
      inspectTerminalClientDisplayCalibration({
        terminalFontSize: 14,
        terminalFontFamily: null,
        terminalDisplayReference: reference,
      }).profileMatches,
    ).toBe(false)
    expect(
      inspectTerminalClientDisplayCalibration({
        terminalFontSize: 13,
        terminalFontFamily: null,
        terminalDisplayReference: null,
      }).calibrationMatchesReference,
    ).toBe(false)

    clearTerminalClientDisplayCalibration()
    expect(
      inspectTerminalClientDisplayCalibration({
        terminalFontSize: 13,
        terminalFontFamily: null,
        terminalDisplayReference: reference,
      }).calibrationPresent,
    ).toBe(false)
  })

  it('keeps a legacy low-confidence calibration stored but never applicable', () => {
    const reference = normalizeTerminalDisplayReference({
      version: 1,
      capture: { algorithmVersion: 1, rendererKind: 'webgl' },
      measurement: {
        fontSize: 13,
        fontFamily: null,
        lineHeight: 1,
        letterSpacing: 0,
        cols: 79,
        rows: 24,
        cssCellWidth: 7.825,
        cssCellHeight: 15,
        effectiveDpr: 2,
        windowDevicePixelRatio: 2,
        visualViewportScale: 1,
        runtime: 'desktop',
        measuredAt: '2026-08-30T15:25:51.328Z',
      },
    })
    writeTerminalClientDisplayCalibration({
      version: 1,
      profileKey: createTerminalDisplayProfileKey({
        terminalFontSize: 13,
        terminalFontFamily: null,
      }),
      fontSize: 13,
      lineHeight: 1,
      letterSpacing: 0,
      target: {
        cols: 79,
        rows: 24,
        cssCellWidth: 7.825,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      measured: {
        cols: 82,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      score: 3032.5,
      measuredAt: '2026-09-01T00:00:00.000Z',
    })

    expect(
      inspectTerminalClientDisplayCalibration({
        terminalFontSize: 13,
        terminalFontFamily: null,
        terminalDisplayReference: reference,
      }),
    ).toMatchObject({
      calibrationPresent: true,
      referenceUsesCurrentAlgorithm: true,
      calibrationMatchesReference: false,
      applicableCalibrationPresent: false,
      calibrationScore: 3032.5,
    })
  })

  it('stores environment proof atomically with a verified calibration', () => {
    const calibration = normalizeTerminalClientDisplayCalibration({
      version: 1,
      profileKey: createTerminalDisplayProfileKey({
        terminalFontSize: 13,
        terminalFontFamily: null,
      }),
      fontSize: 13,
      lineHeight: 1,
      letterSpacing: 0,
      target: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      measured: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      score: 0,
      measuredAt: '2026-04-29T00:00:00.000Z',
    })!

    expect(
      writeTerminalClientDisplayCalibration(calibration, {
        environmentSignature: 'environment-a',
        source: 'automatic',
      }),
    ).toBe(true)
    expect(readStoredTerminalDisplayCalibration()).toMatchObject({
      calibration,
      metadata: { environmentSignature: 'environment-a', source: 'automatic' },
      proof: 'atomic',
    })
    expect(
      JSON.parse(window.localStorage.getItem('opencove:terminal-display-calibration:v1') ?? 'null'),
    ).toMatchObject({
      verification: {
        version: 1,
        environmentSignature: 'environment-a',
        source: 'automatic',
      },
    })
  })

  it('describes saved calibration even when it cannot apply without a reference', () => {
    const profileKey = createTerminalDisplayProfileKey({
      terminalFontSize: 13,
      terminalFontFamily: 'Consolas',
    })
    writeTerminalClientDisplayCalibration({
      version: 1,
      profileKey,
      fontSize: 12.5,
      lineHeight: 1,
      letterSpacing: 0,
      target: {
        cols: 81,
        rows: 24,
        cssCellWidth: 7.5,
        cssCellHeight: 15,
        effectiveDpr: 2,
      },
      score: 0,
      measuredAt: '2026-04-29T00:00:00.000Z',
    })

    expect(
      inspectTerminalClientDisplayCalibration({
        terminalFontSize: 13,
        terminalFontFamily: 'Consolas',
        terminalDisplayReference: null,
      }),
    ).toMatchObject({
      profileKey,
      rawCalibrationPresent: true,
      calibrationPresent: true,
      profileMatches: true,
      referencePresent: false,
      referenceMatchesProfile: false,
      calibrationMatchesReference: false,
      applicableCalibrationPresent: false,
      calibrationFontSize: 12.5,
      calibrationLineHeight: 1,
      calibrationLetterSpacing: 0,
      calibrationScore: 0,
    })
  })
})
