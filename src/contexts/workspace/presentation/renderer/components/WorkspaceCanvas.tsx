import React from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { WorkspaceCanvasInner } from './WorkspaceCanvasInner'
import type { WorkspaceCanvasProps } from './workspaceCanvas/types'

function WorkspaceCanvasComponent(props: WorkspaceCanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

export const WorkspaceCanvas = React.memo(WorkspaceCanvasComponent)
