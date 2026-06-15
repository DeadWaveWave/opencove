import { useEffect, useMemo } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import {
  resolveTerminalDisplayCalibrationCompensation,
  type TerminalClientDisplayCalibration,
} from '@contexts/settings/domain/terminalDisplayCalibration'
import {
  inspectTerminalClientDisplayCalibration,
  useTerminalClientDisplayCalibration,
} from '@contexts/settings/presentation/renderer/terminalDisplayCalibrationStorage'
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
    message: 'Renderer resolved terminal display calibration for workspace geometry.',
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

export function useResolvedTerminalDisplayCalibration(
  agentSettings: Pick<
    AgentSettings,
    | 'terminalFontSize'
    | 'terminalFontFamily'
    | 'terminalDisplayReference'
    | 'terminalDisplayCalibrationCompensationEnabled'
  >,
): TerminalClientDisplayCalibration | null {
  const savedTerminalDisplayCalibration = useTerminalClientDisplayCalibration({
    terminalFontSize: agentSettings.terminalFontSize,
    terminalFontFamily: agentSettings.terminalFontFamily,
    terminalDisplayReference: agentSettings.terminalDisplayReference,
  })

  const appliedTerminalDisplayCalibration = resolveTerminalDisplayCalibrationCompensation({
    calibration: savedTerminalDisplayCalibration,
    compensationEnabled: agentSettings.terminalDisplayCalibrationCompensationEnabled,
  })

  useEffect(() => {
    const inspection = inspectTerminalClientDisplayCalibration({
      terminalFontSize: agentSettings.terminalFontSize,
      terminalFontFamily: agentSettings.terminalFontFamily,
      terminalDisplayReference: agentSettings.terminalDisplayReference,
    })
    logTerminalDisplayCalibrationDiagnostics({
      terminalFontSize: agentSettings.terminalFontSize,
      terminalFontFamily: agentSettings.terminalFontFamily,
      compensationEnabled: agentSettings.terminalDisplayCalibrationCompensationEnabled,
      appliedCalibrationPresent: appliedTerminalDisplayCalibration !== null,
      appliedFontSize: appliedTerminalDisplayCalibration?.fontSize ?? null,
      appliedLineHeight: appliedTerminalDisplayCalibration?.lineHeight ?? null,
      appliedLetterSpacing: appliedTerminalDisplayCalibration?.letterSpacing ?? null,
      appliedCssCellWidth: appliedTerminalDisplayCalibration?.target.cssCellWidth ?? null,
      appliedCssCellHeight: appliedTerminalDisplayCalibration?.target.cssCellHeight ?? null,
      appliedMeasuredCssCellWidth:
        appliedTerminalDisplayCalibration?.measured?.cssCellWidth ?? null,
      appliedMeasuredCssCellHeight:
        appliedTerminalDisplayCalibration?.measured?.cssCellHeight ?? null,
      ...inspection,
    })
  }, [
    agentSettings.terminalDisplayCalibrationCompensationEnabled,
    agentSettings.terminalDisplayReference,
    agentSettings.terminalFontFamily,
    agentSettings.terminalFontSize,
    appliedTerminalDisplayCalibration,
  ])

  return appliedTerminalDisplayCalibration
}

export function useWorkspaceCanvasTerminalDisplay(
  agentSettings: Pick<
    AgentSettings,
    | 'terminalFontSize'
    | 'terminalFontFamily'
    | 'terminalDisplayReference'
    | 'terminalDisplayCalibrationCompensationEnabled'
  >,
): {
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  terminalDisplayMetrics: TerminalPtyGeometryDisplayMetrics
} {
  const terminalDisplayCalibration = useResolvedTerminalDisplayCalibration(agentSettings)
  const terminalDisplayMetrics = useMemo(
    () =>
      resolveTerminalDisplayMetrics({
        terminalFontSize: agentSettings.terminalFontSize,
        terminalDisplayCalibration,
      }),
    [agentSettings.terminalFontSize, terminalDisplayCalibration],
  )

  return { terminalDisplayCalibration, terminalDisplayMetrics }
}
