import React from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { WorkspaceCanvasProps } from './workspaceCanvas/types'
import { WorkspaceCanvasInner } from './workspaceCanvas/WorkspaceCanvasInner'

export function WorkspaceCanvas(props: WorkspaceCanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
