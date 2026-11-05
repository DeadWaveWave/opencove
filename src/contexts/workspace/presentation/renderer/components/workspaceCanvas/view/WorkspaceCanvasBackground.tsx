import React, { useSyncExternalStore } from 'react'
import { Background, BackgroundVariant, type Node } from '@xyflow/react'
import {
  readThemeMotion,
  subscribeThemeMotion,
} from '@contexts/plugins/presentation/renderer/themeMotion'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { useShowcaseMode } from '@app/renderer/shell/showcase/showcaseMode'
import type { TerminalNodeData } from '../../../types'
import { WorkspacePixelLayer } from './WorkspacePixelLayer'
import { WorkspacePixelWall } from './WorkspacePixelWall'
import { WorkspaceWindowSignals } from './windowSignals/WorkspaceWindowSignals'
import { useSpaceVisualScale } from './useSpaceVisualScale'

interface WorkspaceCanvasBackgroundProps {
  settings: Pick<
    AgentSettings,
    | 'uiTheme'
    | 'canvasBackgroundStyle'
    | 'canvasBackgroundTwinkleEnabled'
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
  // Showcase mode always shows the pixel background, whatever the saved style (Tide 6.1).
  const showcase = useShowcaseMode()
  const style = showcase ? 'pixel' : settings.canvasBackgroundStyle
  const effects = {
    // Received-output pixels are an event signal: kept by 「简约」, gone with 「关闭」.
    background: style !== 'off',
    creation: settings.nodeCreationPixelEffectEnabled,
    closing: settings.nodeClosePixelEffectEnabled,
    working: settings.agentWorkingPixelEffectEnabled,
  }
  const enabled = effects.background || effects.creation || effects.closing || effects.working
  const motion = useSyncExternalStore(subscribeThemeMotion, readThemeMotion, readThemeMotion)
  const backgroundEffect = motion.background ?? { preset: 'pixel' }
  // A theme that brings its own background (or none) keeps it; otherwise the wall is the
  // pixel background. 「简约」 and 「关闭」 show the neutral dot grid.
  const wall =
    style === 'pixel' && backgroundEffect.preset === 'pixel' && backgroundEffect.durationMs !== 0

  return (
    <>
      {wall && (
        <WorkspacePixelWall
          ambient={settings.canvasBackgroundTwinkleEnabled}
          signals={settings.agentWorkingPixelEffectEnabled}
        />
      )}
      <WorkspaceWindowSignals
        nodes={nodes}
        canvasRef={canvasRef}
        enabled={settings.agentWorkingPixelEffectEnabled}
      />
      {style !== 'pixel' && (
        <Background
          variant={BackgroundVariant.Dots}
          size={1}
          gap={24}
          color="var(--cove-canvas-dot)"
        />
      )}
      {enabled && (
        <WorkspacePixelLayer
          nodes={nodes}
          options={effects}
          ambient={style === 'pixel'}
          ripples={effects.background && !wall}
        />
      )}
    </>
  )
})
