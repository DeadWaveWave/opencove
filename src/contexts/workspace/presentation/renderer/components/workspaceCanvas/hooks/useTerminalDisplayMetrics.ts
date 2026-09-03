import { useEffect, useMemo } from 'react'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { TerminalPtyGeometryDisplayMetrics } from '@contexts/workspace/domain/terminalPtyGeometry'
import type { RuntimeDiagnosticsDetailValue } from '@shared/contracts/dto'

function runtimeDiagnosticsEnabled(): boolean {
  return window.opencoveApi?.meta?.enableTerminalDiagnostics === true
}

function logTerminalDisplayCalibrationDiagnostics(
  details: Record<string, RuntimeDiagnosticsDetailValue>,
): void {
  if (!runtimeDiagnosticsEnabled()) {
    return
  }

  window.opencoveApi?.debug?.logRuntimeDiagnostics?.({
    source: 'renderer-workspace-canvas',
    level: 'info',
    event: 'terminal-display-calibration:resolved',
    message: 'Renderer resolved verified terminal display calibration for workspace geometry.',
    details,
  })
}

export function resolveTerminalDisplayMetrics({
  terminalFontSize,
  terminalDisplayCalibration,
}: {
  terminalFontSize: number
  terminalDisplayCalibration?: TerminalClientDisplayCalibration | null
}): TerminalPtyGeometryDisplayMetrics {
  return {
    fontSize: terminalDisplayCalibration?.fontSize ?? terminalFontSize,
    lineHeight: terminalDisplayCalibration?.lineHeight ?? 1,
    letterSpacing: terminalDisplayCalibration?.letterSpacing ?? 0,
    cssCellWidth: terminalDisplayCalibration?.measured?.cssCellWidth ?? null,
    cssCellHeight: terminalDisplayCalibration?.measured?.cssCellHeight ?? null,
  }
}

export function useTerminalMetrics(
  terminalFontSize: number,
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null,
): TerminalPtyGeometryDisplayMetrics {
  const terminalDisplayMetrics = useMemo(
    () => resolveTerminalDisplayMetrics({ terminalFontSize, terminalDisplayCalibration }),
    [terminalDisplayCalibration, terminalFontSize],
  )

  useEffect(() => {
    logTerminalDisplayCalibrationDiagnostics({
      terminalFontSize,
      appliedCalibrationPresent: terminalDisplayCalibration !== null,
      appliedFontSize: terminalDisplayCalibration?.fontSize ?? null,
      appliedLineHeight: terminalDisplayCalibration?.lineHeight ?? null,
      appliedLetterSpacing: terminalDisplayCalibration?.letterSpacing ?? null,
      appliedCssCellWidth: terminalDisplayCalibration?.target.cssCellWidth ?? null,
      appliedCssCellHeight: terminalDisplayCalibration?.target.cssCellHeight ?? null,
      appliedMeasuredCssCellWidth: terminalDisplayCalibration?.measured?.cssCellWidth ?? null,
      appliedMeasuredCssCellHeight: terminalDisplayCalibration?.measured?.cssCellHeight ?? null,
    })
  }, [terminalDisplayCalibration, terminalFontSize])

  return terminalDisplayMetrics
}
