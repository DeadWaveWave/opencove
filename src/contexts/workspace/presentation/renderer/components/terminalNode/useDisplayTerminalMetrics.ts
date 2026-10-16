import { useRef } from 'react'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'

/** The metrics this display renders with: calibrated when calibration applies, shared otherwise. */
export function useDisplayTerminalMetrics(
  terminalFontSize: number,
  calibration: TerminalClientDisplayCalibration | null,
) {
  const displayTerminalFontSize = calibration?.fontSize ?? terminalFontSize
  const displayTerminalLineHeight = calibration?.lineHeight ?? 1
  const displayTerminalLetterSpacing = calibration?.letterSpacing ?? 0
  const displayTerminalMetricsRef = useRef({
    fontSize: displayTerminalFontSize,
    lineHeight: displayTerminalLineHeight,
    letterSpacing: displayTerminalLetterSpacing,
  })
  displayTerminalMetricsRef.current = {
    fontSize: displayTerminalFontSize,
    lineHeight: displayTerminalLineHeight,
    letterSpacing: displayTerminalLetterSpacing,
  }
  return {
    displayTerminalFontSize,
    displayTerminalLineHeight,
    displayTerminalLetterSpacing,
    displayTerminalMetricsRef,
  }
}
