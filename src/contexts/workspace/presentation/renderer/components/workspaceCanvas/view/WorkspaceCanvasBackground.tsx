import React, { useSyncExternalStore } from 'react'
import { Background, BackgroundVariant, type Node } from '@xyflow/react'
import {
  readThemeMotion,
  subscribeThemeMotion,
} from '@contexts/plugins/presentation/renderer/themeMotion'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../types'
import { WorkspacePixelLayer } from './WorkspacePixelLayer'
import { WorkspacePixelWall } from './WorkspacePixelWall'
import { useSpaceVisualScale } from './useSpaceVisualScale'

interface WorkspaceCanvasBackgroundProps {
  settings: Pick<
    AgentSettings,
    | 'uiTheme'
    | 'canvasPixelBackgroundEnabled'
    | 'nodeCreationPixelEffectEnabled'
    | 'nodeClosePixelEffectEnabled'
    | 'agentWorkingPixelEffectEnabled'
  >
  canvasRef: React.RefObject<HTMLDivElement | null>
  nodes: Node<TerminalNodeData>[]
}

export const WorkspaceCanvasBackground = React.memo(function WorkspaceCanvasBackground({
  settings,
  canvasRef,
  nodes,
}: WorkspaceCanvasBackgroundProps): React.JSX.Element {
  useSpaceVisualScale(canvasRef)
  const effects = {
    background: settings.canvasPixelBackgroundEnabled,
    creation: settings.nodeCreationPixelEffectEnabled,
    closing: settings.nodeClosePixelEffectEnabled,
    working: settings.agentWorkingPixelEffectEnabled,
  }
  const enabled = effects.background || effects.creation || effects.closing || effects.working
  const motion = useSyncExternalStore(subscribeThemeMotion, readThemeMotion, readThemeMotion)
  const backgroundEffect = motion.background ?? { preset: 'pixel' }
  // A theme that brings its own background (or none) keeps it; otherwise the wall is the
  // background and the particle layer above it only draws effects.
  const wall =
    effects.background && backgroundEffect.preset === 'pixel' && backgroundEffect.durationMs !== 0

  return (
    <>
      {wall && <WorkspacePixelWall />}
      {!effects.background && (
        <Background
          variant={BackgroundVariant.Dots}
          size={1}
          gap={24}
          color="var(--cove-canvas-dot)"
        />
      )}
      {enabled && <WorkspacePixelLayer nodes={nodes} options={effects} wall={wall} />}
    </>
  )
})
