import type { Node } from '@xyflow/react'
import {
  commitCanvasDocument,
  type WorkspaceDocumentCommandResult,
} from '../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../src/contexts/workspace/presentation/renderer/types'

/**
 * Seeds or replaces the nodes of a workspace's document, for a test that stands in for a write
 * from elsewhere (runtime observation, sync, another window). It goes through the document module
 * like every write, so it is subject to the same development guard.
 */
export function setDocumentNodes(
  workspaceId: string,
  nodes: Node<TerminalNodeData>[],
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(workspaceId, document => ({ ...document, nodes }))
}
