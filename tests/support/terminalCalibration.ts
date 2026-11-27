import type { TerminalClientDisplayCalibration } from '../../src/contexts/settings/domain/terminalDisplayCalibration'

/** An applied calibration whose measured cell is `cssCellWidth` wide: more width, fewer columns. */
export function terminalCalibration(cssCellWidth: number): TerminalClientDisplayCalibration {
  const measured = { cols: 80, rows: 24, cssCellWidth, cssCellHeight: 20, effectiveDpr: 1 }
  return {
    version: 1,
    profileKey: 'profile',
    fontSize: 13,
    lineHeight: 1,
    letterSpacing: 0,
    target: measured,
    measured,
    score: 1,
    measuredAt: '2026-01-01T00:00:00.000Z',
  }
}
