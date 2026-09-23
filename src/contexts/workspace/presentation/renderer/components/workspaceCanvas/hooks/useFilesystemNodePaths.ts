import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { ResolveMountTargetResult } from '@shared/contracts/dto'
import { normalizeFileUri } from '@shared/utils/fileUriScope'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
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
  nodesRef,
  spacesRef,
  onShowMessage,
}: {
  workspaceId: string
  workspacePath?: string
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onShowMessage?: ShowWorkspaceCanvasMessage
}) {
  const { t } = useTranslation()
  const lifetime = useRef<object | null>(null)
  useLayoutEffect(() => {
    lifetime.current = {}
    return () => {
      lifetime.current = null
    }
  }, [workspaceId])
  const getNodePathUri = useCallback(
    (id: string) => {
      const node = nodesRef.current.find(item => item.id === id)
      return node ? getFilesystemNodeUri(node.data) : null
    },
    [nodesRef],
  )
  const copyNodePath = useCallback(
    async (id: string, relative: boolean) => {
      const node = nodesRef.current.find(item => item.id === id)
      const uri = node ? getFilesystemNodeUri(node.data) : null
      if (!node || !uri) {
        return
      }
      const epoch = lifetime.current
      const isCurrent = () => epoch !== null && epoch === lifetime.current
      try {
        const rootUri = relative
          ? await resolveFilesystemNodeRootUri({ node, spaces: spacesRef.current, workspacePath })
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
    [nodesRef, onShowMessage, spacesRef, t, workspacePath],
  )
  return { getNodePathUri, copyNodePath }
}
