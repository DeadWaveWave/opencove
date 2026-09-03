import React from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { WorkspaceCanvasInner } from './WorkspaceCanvasInner'
import type { WorkspaceCanvasProps } from './workspaceCanvas/types'
import { useTerminalMetrics } from './workspaceCanvas/hooks/useTerminalDisplayMetrics'

function WorkspaceCanvasComponent(props: WorkspaceCanvasProps): React.JSX.Element {
  const terminalDisplayMetrics = useTerminalMetrics(
    props.agentSettings.terminalFontSize,
    props.terminalDisplayCalibration ?? null,
  )
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} terminalDisplayMetrics={terminalDisplayMetrics} />
    </ReactFlowProvider>
  )
}

export const WorkspaceCanvas = React.memo(WorkspaceCanvasComponent)
