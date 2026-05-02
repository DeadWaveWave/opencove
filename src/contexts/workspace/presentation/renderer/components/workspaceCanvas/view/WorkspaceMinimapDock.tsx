import React from 'react'
import { MiniMap, useReactFlow, type Edge, type Node, type XYPosition } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { Map as MapIcon } from 'lucide-react'
import type { TerminalNodeData } from '../../../types'
import { centerFlowPositionInViewportPreservingZoom } from '../helpers'

interface WorkspaceMinimapDockProps {
  isMinimapVisible: boolean
  minimapNodeColor: (node: Node<TerminalNodeData>) => string
  setIsMinimapVisible: React.Dispatch<React.SetStateAction<boolean>>
  onMinimapVisibilityChange: (isVisible: boolean) => void
}

export function WorkspaceMinimapDock({
  isMinimapVisible,
  minimapNodeColor,
  setIsMinimapVisible,
  onMinimapVisibilityChange,
}: WorkspaceMinimapDockProps): React.JSX.Element {
  const { t } = useTranslation()
  const reactFlow = useReactFlow<Node<TerminalNodeData>, Edge>()

  const handleMinimapClick = React.useCallback(
    (event: React.MouseEvent<Element>, position: XYPosition) => {
      if (event.detail !== 2) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      centerFlowPositionInViewportPreservingZoom(reactFlow, position, { duration: 180 })
    },
    [reactFlow],
  )

  return (
    <div
      className={`workspace-canvas__minimap-dock${isMinimapVisible ? ' workspace-canvas__minimap-dock--expanded' : ''}`}
    >
      {isMinimapVisible ? (
        <MiniMap
          className="workspace-canvas__minimap"
          pannable
          zoomable
          onClick={handleMinimapClick}
          nodeColor={minimapNodeColor}
          nodeBorderRadius={6}
          maskColor="var(--cove-canvas-minimap-mask-surface)"
        />
      ) : null}

      <button
        type="button"
        className="workspace-canvas__minimap-toggle"
        data-testid="workspace-minimap-toggle"
        aria-label={
          isMinimapVisible ? t('workspaceCanvas.hideMinimap') : t('workspaceCanvas.showMinimap')
        }
        title={
          isMinimapVisible ? t('workspaceCanvas.hideMinimap') : t('workspaceCanvas.showMinimap')
        }
        onClick={event => {
          event.stopPropagation()
          setIsMinimapVisible(previous => {
            const nextValue = !previous
            onMinimapVisibilityChange(nextValue)
            return nextValue
          })
        }}
      >
        <MapIcon aria-hidden="true" />
      </button>
    </div>
  )
}
