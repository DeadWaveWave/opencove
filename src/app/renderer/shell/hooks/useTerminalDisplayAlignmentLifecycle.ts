import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import { useTerminalClientDisplayAutoCalibration } from '@contexts/settings/presentation/renderer/useTerminalClientDisplayAutoCalibration'
import { useTerminalDisplayReferenceAutoCapture } from '@contexts/settings/presentation/renderer/useTerminalDisplayReferenceAutoCapture'
import { useTerminalDisplayCalibrationProjection } from '@contexts/settings/presentation/renderer/useTerminalDisplayCalibrationProjection'

export function useTerminalDisplayAlignmentLifecycle(options: {
  isPersistReady: boolean
  agentSettings: AgentSettings
  setAgentSettings: (action: AgentSettings | ((previous: AgentSettings) => AgentSettings)) => void
}): TerminalClientDisplayCalibration | null {
  useTerminalDisplayReferenceAutoCapture({
    enabled: options.isPersistReady && options.agentSettings.terminalDisplayAutoReferenceEnabled,
    agentSettings: options.agentSettings,
    setAgentSettings: options.setAgentSettings,
  })
  useTerminalClientDisplayAutoCalibration({
    enabled:
      options.isPersistReady && options.agentSettings.terminalDisplayCalibrationCompensationEnabled,
    agentSettings: options.agentSettings,
  })
  return useTerminalDisplayCalibrationProjection({
    terminalFontSize: options.agentSettings.terminalFontSize,
    terminalFontFamily: options.agentSettings.terminalFontFamily,
    terminalDisplayReference: options.agentSettings.terminalDisplayReference,
  })
}
