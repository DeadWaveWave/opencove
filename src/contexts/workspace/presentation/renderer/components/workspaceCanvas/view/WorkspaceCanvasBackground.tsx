import React from 'react'
import { Background, BackgroundVariant, type Node } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../types'
import { WorkspacePixelLayer } from './WorkspacePixelLayer'
import { usePixelSpaceDetail } from './usePixelSpaceDetail'

interface WorkspaceCanvasBackgroundProps {
  settings: Pick<
    AgentSettings,
    | 'uiTheme'
    | 'canvasPixelBackgroundEnabled'
    | 'nodeCreationPixelEffectEnabled'
    | 'nodeClosePixelEffectEnabled'
  >
  canvasRef: React.RefObject<HTMLDivElement | null>
  nodes: Node<TerminalNodeData>[]
}

export const WorkspaceCanvasBackground = React.memo(function WorkspaceCanvasBackground({
  settings,
  canvasRef,
  nodes,
}: WorkspaceCanvasBackgroundProps): React.JSX.Element {
  usePixelSpaceDetail(canvasRef, settings.uiTheme)
  const effects = {
    background: settings.canvasPixelBackgroundEnabled,
    creation: settings.nodeCreationPixelEffectEnabled,
    closing: settings.nodeClosePixelEffectEnabled,
  }
  const enabled = effects.background || effects.creation || effects.closing

  return (
    <>
      {!effects.background && (
        <Background
          variant={BackgroundVariant.Dots}
          size={1}
          gap={24}
          color="var(--cove-canvas-dot)"
        />
      )}
      {enabled && <WorkspacePixelLayer nodes={nodes} options={effects} />}
    </>
  )
})
