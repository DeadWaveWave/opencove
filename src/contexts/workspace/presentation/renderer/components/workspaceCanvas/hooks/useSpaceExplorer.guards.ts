import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { isWithinDirectoryUri } from '../view/WorkspaceSpaceExplorerOverlay.operations'

export interface SpaceExplorerOpenDocumentBlock {
  title: string
  uri: string
}

export function findBlockingOpenDocumentForMutation(
  nodes: Node<TerminalNodeData>[],
  targetUri: string,
): SpaceExplorerOpenDocumentBlock | null {
  for (const node of nodes) {
    if (node.data.kind !== 'document' || !node.data.document) {
      continue
    }

    const documentUri = node.data.document.uri
    if (
      documentUri === targetUri ||
      isWithinDirectoryUri(targetUri, documentUri) ||
      isWithinDirectoryUri(documentUri, targetUri)
    ) {
      return {
        title: node.data.title,
        uri: documentUri,
      }
    }
  }

  return null
}
