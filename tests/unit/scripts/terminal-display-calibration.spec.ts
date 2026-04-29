import { describe, expect, it } from 'vitest'
import {
  buildTerminalDisplayCalibrationCandidates,
  scoreTerminalDisplayCalibrationCandidate,
  summarizeTerminalDisplayCalibration,
} from '../../../scripts/lib/terminal-display-calibration.mjs'

const targetMetrics = {
  size: { cols: 81, rows: 24 },
  renderMetrics: { cssCellWidth: 7.5, cssCellHeight: 15, effectiveDpr: 2 },
}

describe('terminal display calibration', () => {
  it('builds a conservative candidate grid around the base font size', () => {
    const candidates = buildTerminalDisplayCalibrationCandidates({
      baseFontSize: 13,
      fontSizeRadius: 0.5,
      fontSizeStep: 0.25,
      lineHeights: [1],
      letterSpacings: [0],
    })

    expect(candidates).toEqual([
      { fontSize: 12.5, lineHeight: 1, letterSpacing: 0 },
      { fontSize: 12.75, lineHeight: 1, letterSpacing: 0 },
      { fontSize: 13, lineHeight: 1, letterSpacing: 0 },
      { fontSize: 13.25, lineHeight: 1, letterSpacing: 0 },
      { fontSize: 13.5, lineHeight: 1, letterSpacing: 0 },
    ])
  })

  it('prefers exact geometry and cell metrics when ranking candidates', () => {
    const exact = scoreTerminalDisplayCalibrationCandidate({
      targetMetrics,
      candidate: { fontSize: 12.5, lineHeight: 1, letterSpacing: 0 },
      preferredCandidate: { fontSize: 13, lineHeight: 1, letterSpacing: 0 },
      candidateMetrics: {
        proposedGeometry: { cols: 81, rows: 24 },
        renderMetrics: { cssCellWidth: 7.5, cssCellHeight: 15, effectiveDpr: 2 },
      },
    })
    const oversized = scoreTerminalDisplayCalibrationCandidate({
      targetMetrics,
      candidate: { fontSize: 13, lineHeight: 1, letterSpacing: 0 },
      preferredCandidate: { fontSize: 13, lineHeight: 1, letterSpacing: 0 },
      candidateMetrics: {
        proposedGeometry: { cols: 86, rows: 24 },
        renderMetrics: { cssCellWidth: 7, cssCellHeight: 15, effectiveDpr: 1 },
      },
    })

    expect(summarizeTerminalDisplayCalibration([oversized, exact]).best).toMatchObject({
      candidate: { fontSize: 12.5, lineHeight: 1, letterSpacing: 0 },
      exactGeometry: true,
      exactCellMetrics: true,
    })
  })

  it('prefers the nearest current appearance when candidates tie', () => {
    const current = { fontSize: 13, lineHeight: 1, letterSpacing: 0 }
    const far = scoreTerminalDisplayCalibrationCandidate({
      targetMetrics,
      candidate: { fontSize: 12.5, lineHeight: 1, letterSpacing: 0 },
      preferredCandidate: current,
      candidateMetrics: {
        proposedGeometry: { cols: 81, rows: 24 },
        renderMetrics: { cssCellWidth: 7.5, cssCellHeight: 15, effectiveDpr: 2 },
      },
    })
    const near = scoreTerminalDisplayCalibrationCandidate({
      targetMetrics,
      candidate: current,
      preferredCandidate: current,
      candidateMetrics: {
        proposedGeometry: { cols: 81, rows: 24 },
        renderMetrics: { cssCellWidth: 7.5, cssCellHeight: 15, effectiveDpr: 2 },
      },
    })

    expect(summarizeTerminalDisplayCalibration([far, near]).best?.candidate).toEqual(current)
  })
})
