import { useMemo } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { DetectedCanvasInputMode } from '../../../utils/inputModality'

export function useWorkspaceCanvasDerivedConfig({
  agentSettings,
  detectedCanvasInputMode,
}: {
  agentSettings: Pick<AgentSettings, 'canvasInputMode' | 'taskTagOptions'>
  detectedCanvasInputMode: DetectedCanvasInputMode
}): {
  taskTagOptions: string[]
  resolvedCanvasInputMode: DetectedCanvasInputMode
  isTrackpadCanvasMode: boolean
  useManualCanvasWheelGestures: boolean
} {
  const taskTagOptions = useMemo(() => {
    const fromSettings = agentSettings.taskTagOptions ?? []
    return [...new Set(fromSettings.map(tag => tag.trim()).filter(tag => tag.length > 0))]
  }, [agentSettings.taskTagOptions])

  const resolvedCanvasInputMode: DetectedCanvasInputMode =
    agentSettings.canvasInputMode === 'auto'
      ? detectedCanvasInputMode
      : agentSettings.canvasInputMode

  return useMemo(
    () => ({
      taskTagOptions,
      resolvedCanvasInputMode,
      isTrackpadCanvasMode: resolvedCanvasInputMode === 'trackpad',
      useManualCanvasWheelGestures: agentSettings.canvasInputMode !== 'mouse',
    }),
    [agentSettings.canvasInputMode, resolvedCanvasInputMode, taskTagOptions],
  )
}
