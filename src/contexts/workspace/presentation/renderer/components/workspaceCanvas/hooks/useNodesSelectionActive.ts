import { useEffect } from 'react'
import { useStore, useStoreApi } from '@xyflow/react'

export function useWorkspaceCanvasNodesSelectionActive(selectedNodeCount: number): void {
  const reactFlowStore = useStoreApi()
  const userSelectionActive = useStore(state => state.userSelectionActive)
  const nodesSelectionActive = useStore(state => state.nodesSelectionActive)

  useEffect(() => {
    if (userSelectionActive) {
      return
    }

    // Controlled flow nodes can lag behind the selection owner and steal input focus if reused here.
    const shouldShowNodesSelection = selectedNodeCount > 0
    if (nodesSelectionActive === shouldShowNodesSelection) {
      return
    }

    reactFlowStore.setState({
      nodesSelectionActive: shouldShowNodesSelection,
    })
  }, [nodesSelectionActive, reactFlowStore, selectedNodeCount, userSelectionActive])
}
