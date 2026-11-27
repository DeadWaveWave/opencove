import type { Dispatch, SetStateAction } from 'react'
import type { Node } from '@xyflow/react'
import type {
  NodesCommit,
  NodesRelease,
} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges.helpers'
import type { WorkspaceCanvasNodeDragSession } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import type { TerminalNodeData } from '../../src/contexts/workspace/presentation/renderer/types'
import { removeNodesAndUnlink } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useApplyNodeChanges'
import {
  applyLiveNodes,
  applyReleasedPositions,
} from '../../src/contexts/workspace/presentation/renderer/utils/canvasLiveNodes'

/**
 * The three outputs of the change path, kept in a component's own node state: a frame applies the
 * overlay, a release applies its entries, any other batch applies its removals and settled
 * positions. For a spec that
 * drives the change path with mocks and reads the result from that state. `onRelease` also gets
 * the release, for a spec that writes the document with the real publisher.
 */
export function changePathIntoState(
  setNodes: Dispatch<SetStateAction<Node<TerminalNodeData>[]>>,
  onRelease?: (release: NodesRelease) => void,
) {
  return {
    onNodesChange: (liveNodes: NodesRelease['liveNodes']) =>
      setNodes(current => applyLiveNodes(current, liveNodes)),
    onNodesCommit: ({ removedIds, settledPositions }: NodesCommit) =>
      setNodes(current =>
        applyReleasedPositions(removeNodesAndUnlink(current, removedIds), settledPositions),
      ),
    onNodesRelease: (release: NodesRelease) => {
      onRelease?.(release)
      setNodes(current => applyLiveNodes(current, release.liveNodes))
    },
  }
}

/**
 * What the change path does at a release, without its frames: ends the session and writes what the
 * release writes besides the windows (the Space frames of a Space-dominant drag) through the real
 * publisher. For a spec that drives the session directly and stands in for the release.
 */
export function releaseSession(
  session: Pick<WorkspaceCanvasNodeDragSession, 'endNodeDragSession'>,
  publishers: { commitNodesRelease: (release: NodesRelease) => void },
): void {
  const spaceRects = session.endNodeDragSession()
  publishers.commitNodesRelease({ liveNodes: new Map(), removedIds: new Set(), spaceRects })
}
