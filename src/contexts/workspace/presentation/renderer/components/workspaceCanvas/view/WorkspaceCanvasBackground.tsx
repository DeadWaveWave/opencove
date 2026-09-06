import React from 'react'
import { Background, BackgroundVariant, type Node } from '@xyflow/react'
import type { UiTheme } from '@contexts/settings/domain/uiSettings'
import type { TerminalNodeData } from '../../../types'
import { WorkspacePixelLayer } from './WorkspacePixelLayer'

interface WorkspaceCanvasBackgroundProps {
  theme: UiTheme
  nodes: Node<TerminalNodeData>[]
}

export const WorkspaceCanvasBackground = React.memo(function WorkspaceCanvasBackground({
  theme,
  nodes,
}: WorkspaceCanvasBackgroundProps): React.JSX.Element {
  if (theme === 'pixel') {
    return <WorkspacePixelLayer nodes={nodes} />
  }

  return (
    <Background variant={BackgroundVariant.Dots} size={1} gap={24} color="var(--cove-canvas-dot)" />
  )
})
