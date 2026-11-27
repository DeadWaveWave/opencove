import { useCallback } from 'react'
import { applyReleasedPositions, type LiveNodes } from '../../../utils/canvasLiveNodes'
import { useCanvasInteractionCommands } from '../../../store/canvasStoreContext'
import {
  commitCanvasDocument,
  requestWorkspaceDocumentPersistFlush,
} from '../../../store/workspaceDocumentCommands'
import {
  applySpaceFramePreview,
  type NodesCommit,
  type NodesRelease,
} from './useApplyNodeChanges.helpers'
import { removeNodesAndUnlink } from './useApplyNodeChanges'

export function useWorkspaceCanvasNodePublishers({ workspaceId }: { workspaceId: string }): {
  publishLiveNodesChange: (liveNodes: LiveNodes) => void
  commitNodesChange: (commit: NodesCommit) => void
  commitNodesRelease: (release: NodesRelease) => void
} {
  const { publishLiveNodes } = useCanvasInteractionCommands()

  // A drag frame reaches the overlay in the canvas store, not the document.
  const publishLiveNodesChange = useCallback(
    (liveNodes: LiveNodes) => publishLiveNodes(liveNodes),
    [publishLiveNodes],
  )

  // The change path computes a batch from the stores when it runs and writes what the batch does
  // to the document: its removals, then its settled positions, as one recipe over the committed
  // nodes. A batch that only selects reaches no commit. A canvas write does not end the overlay
  // (S6, PR 4); the release does, in the change path, right after its own write.
  const commitNodesChange = useCallback(
    ({ removedIds, settledPositions }: NodesCommit) => {
      commitCanvasDocument(workspaceId, document => {
        const nodes = applyReleasedPositions(
          removeNodesAndUnlink(document.nodes, removedIds),
          settledPositions,
        )
        return nodes === document.nodes ? document : { ...document, nodes }
      })
    },
    [workspaceId],
  )

  // The release is one write, computed from the store as it is when it runs: the gesture's windows
  // at their release position (the entries of the release array, their positions only, nothing of
  // the other windows) and, in a Space-dominant drag, the frame rects. A release that changes nothing writes nothing, and
  // the persistence flush is requested only when a Space rect changed.
  const commitNodesRelease = useCallback(
    ({ liveNodes, removedIds, spaceRects }: NodesRelease) => {
      let didChangeSpaceRect = false
      commitCanvasDocument(workspaceId, document => {
        const nodes = applyReleasedPositions(
          removeNodesAndUnlink(document.nodes, removedIds),
          liveNodes,
        )
        const spaces = spaceRects
          ? applySpaceFramePreview(document.spaces, spaceRects)
          : document.spaces
        didChangeSpaceRect = spaces !== document.spaces

        return nodes === document.nodes && spaces === document.spaces
          ? document
          : { ...document, nodes, spaces }
      })

      if (didChangeSpaceRect) {
        requestWorkspaceDocumentPersistFlush()
      }
    },
    [workspaceId],
  )

  return { publishLiveNodesChange, commitNodesChange, commitNodesRelease }
}
