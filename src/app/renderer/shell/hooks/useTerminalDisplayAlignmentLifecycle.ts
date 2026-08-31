import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { useTerminalClientDisplayAutoCalibration } from '@contexts/settings/presentation/renderer/useTerminalClientDisplayAutoCalibration'
import { useTerminalDisplayReferenceAutoCapture } from '@contexts/settings/presentation/renderer/useTerminalDisplayReferenceAutoCapture'

export function useTerminalDisplayAlignmentLifecycle(options: {
  isPersistReady: boolean
  agentSettings: AgentSettings
  setAgentSettings: (action: AgentSettings | ((previous: AgentSettings) => AgentSettings)) => void
}): void {
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
}
