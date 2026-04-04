import { useEffect } from 'react'
import { useStore, useStoreApi } from '@xyflow/react'

export function useWorkspaceCanvasNodesSelectionActive(): void {
  const reactFlowStore = useStoreApi()
  const userSelectionActive = useStore(state => state.userSelectionActive)
  const nodesSelectionActive = useStore(state => state.nodesSelectionActive)
  const selectedNodeCount = useStore(state => state.nodes.filter(node => node.selected).length)

  useEffect(() => {
    if (userSelectionActive) {
      return
    }

    const shouldShowNodesSelection = selectedNodeCount > 0
    if (nodesSelectionActive === shouldShowNodesSelection) {
      return
    }

    reactFlowStore.setState({
      nodesSelectionActive: shouldShowNodesSelection,
    })
  }, [nodesSelectionActive, reactFlowStore, selectedNodeCount, userSelectionActive])
}
