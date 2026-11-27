import { useCallback, useLayoutEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { fromFileUri, toFileUri } from '@contexts/filesystem/domain'
import type { ResolveMountTargetResult } from '@shared/contracts/dto'
import { normalizeFileUri } from '@shared/utils/fileUriScope'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { resolveFilesystemNodeMountId } from '../filesystemNodeBinding'
import { toErrorMessage } from '../helpers'
import {
  copyExplorerAbsolutePath,
  copyExplorerRelativePath,
} from '../view/WorkspaceSpaceExplorerOverlay.clipboard'

export function getFilesystemNodeUri(data: TerminalNodeData): string | null {
  const uri =
    data.kind === 'folder' ? data.folder?.uri : data.kind === 'document' ? data.document?.uri : null
  return normalizeFileUri(uri)
}

/**
 * The single decision behind "Create Space from This Directory": a folder node that no Space owns
 * yet, resolved to its directory path. Returns null when the node is not a folder, a Space already
 * owns it, or it has no usable directory. The menu, the pre-query warning and the post-query
 * re-check all call this, so a change while `mount.list` is pending writes nothing
 * (SPACE_LIFECYCLE_SPEC invariant 7). The kind test is an exit guard.
 */
export function resolveTopLevelSpaceDirectoryFromNode(
  document: { nodes: Node<TerminalNodeData>[]; spaces: WorkspaceSpaceState[] },
  nodeId: string,
): string | null {
  const node = document.nodes.find(item => item.id === nodeId)
  if (!node || node.data.kind !== 'folder') {
    return null
  }
  if (document.spaces.some(space => space.nodeIds.includes(nodeId))) {
    return null
  }
  const uri = getFilesystemNodeUri(node.data)
  const directoryPath = uri ? fromFileUri(uri) : null
  return directoryPath && directoryPath.trim().length > 0 ? directoryPath : null
}

export async function resolveFilesystemNodeRootUri({
  node,
  spaces,
  workspacePath,
}: {
  node: Node<TerminalNodeData>
  spaces: WorkspaceSpaceState[]
  workspacePath: string
}): Promise<string | null> {
  if (node.data.kind === 'folder') {
    return normalizeFileUri(node.data.folder?.rootUri)
  }
  const mountId = resolveFilesystemNodeMountId(node.id, node.data, spaces)
  if (mountId === undefined) {
    return null
  }
  if (mountId !== null) {
    const target = await window.opencoveApi?.controlSurface?.invoke<ResolveMountTargetResult>({
      kind: 'query',
      id: 'mountTarget.resolve',
      payload: { mountId },
    })
    if (
      !target ||
      target.mountId !== mountId ||
      (node.data.workerBinding && target.endpointId !== node.data.workerBinding.endpointId)
    ) {
      return null
    }
    return normalizeFileUri(target.rootUri)
  }
  const localSpace = spaces.find(space => space.nodeIds.includes(node.id) && !space.targetMountId)
  const directory = localSpace?.directoryPath.trim() || workspacePath.trim()
  return directory ? normalizeFileUri(toFileUri(directory)) : null
}

export function useFilesystemNodePaths({
  workspaceId,
  workspacePath = '',
  onShowMessage,
}: {
  workspaceId: string
  workspacePath?: string
  onShowMessage?: ShowWorkspaceCanvasMessage
}) {
  const { t } = useTranslation()
  const readDocument = useReadCanvasDocument()
  const lifetime = useRef<object | null>(null)
  useLayoutEffect(() => {
    lifetime.current = {}
    return () => {
      lifetime.current = null
    }
  }, [workspaceId])
  const getNodePathUri = useCallback(
    (id: string) => {
      const node = readDocument().nodes.find(item => item.id === id)
      return node ? getFilesystemNodeUri(node.data) : null
    },
    [readDocument],
  )
  // Folder nodes only, and hidden once a Space owns the node: creating inside a Space makes a
  // child Space, which the top-level "Create Space from This Directory" shortcut does not express
  // (SPACE_LIFECYCLE_SPEC). Shares the handler's single decision function.
  const isTopLevelSpaceDirectoryCandidate = useCallback(
    (id: string) => resolveTopLevelSpaceDirectoryFromNode(readDocument(), id) !== null,
    [readDocument],
  )
  const copyNodePath = useCallback(
    async (id: string, relative: boolean) => {
      const { nodes, spaces } = readDocument()
      const node = nodes.find(item => item.id === id)
      const uri = node ? getFilesystemNodeUri(node.data) : null
      if (!node || !uri) {
        return
      }
      const epoch = lifetime.current
      const isCurrent = () => epoch !== null && epoch === lifetime.current
      try {
        const rootUri = relative
          ? await resolveFilesystemNodeRootUri({ node, spaces, workspacePath })
          : uri
        if (!isCurrent()) {
          return
        }
        if (!rootUri) {
          onShowMessage?.(t('spaceExplorer.copyRelativePathFailed'), 'error')
          return
        }
        const options = {
          uri,
          rootUri,
          selectedEntryUri: null,
          closeContextMenu: () => {},
          t,
          onShowMessage: ((message, kind) => {
            if (isCurrent()) {
              onShowMessage?.(message, kind)
            }
          }) as ShowWorkspaceCanvasMessage,
          allowOutsideRoot: true,
        }
        await (relative ? copyExplorerRelativePath(options) : copyExplorerAbsolutePath(options))
      } catch (error) {
        if (isCurrent()) {
          onShowMessage?.(toErrorMessage(error), 'error')
        }
      }
    },
    [onShowMessage, readDocument, t, workspacePath],
  )
  return { getNodePathUri, copyNodePath, isTopLevelSpaceDirectoryCandidate }
}
