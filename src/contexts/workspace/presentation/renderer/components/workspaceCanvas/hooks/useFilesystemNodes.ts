import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type DragEventHandler,
} from 'react'
import { useReactFlow } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { isFileUriWithinRoot, resolveFileUriName } from '@shared/utils/fileUriScope'
import { normalizeFolderNodeData } from '@shared/utils/folderNodeData'
import type { FolderNodeData, Point, WorkspaceSpaceState } from '../../../types'
import { guardNodeFromSyncOverwrite } from '../../../utils/syncNodeGuards'
import { getCollapsedNodeSize } from '../../../utils/canvasCollapse'
import { resolveFilesystemApiForMount } from '../../../utils/mountAwareFilesystemApi'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { toErrorMessage } from '../helpers'
import {
  hasFilesystemEntryDragData,
  readFilesystemEntryDragData,
  isFilesystemCanvasDropTarget,
  type FilesystemEntryDragData,
} from '../filesystemDrag'
import {
  resolveFilesystemEntryBinding,
  resolveFilesystemNodeMountId,
} from '../filesystemNodeBinding'
import {
  findContainingSpaceByAnchor,
  assignNodeToSpaceAndExpand,
} from './useInteractions.spaceAssignment'
import { findBlockingOpenDocumentForMutation } from './useSpaceExplorer.guards'
import { useFilesystemNodePaths } from './useFilesystemNodePaths'
import {
  useNativeFilesystemDrop,
  type FilesystemMaterializeOptions,
} from './useNativeFilesystemDrop'

export interface FilesystemNodesParams {
  workspaceId: string
  workspacePath?: string
  nodeStore: Pick<
    UseWorkspaceCanvasNodesStoreResult,
    'nodesRef' | 'setNodes' | 'createDocumentNode' | 'createFolderNode'
  >
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}

export function useFilesystemNodes({
  workspaceId,
  workspacePath,
  nodeStore,
  spacesRef,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
}: FilesystemNodesParams) {
  const { t } = useTranslation()
  const reactFlow = useReactFlow()
  const { nodesRef, setNodes, createDocumentNode, createFolderNode } = nodeStore
  const { getNodePathUri, copyNodePath } = useFilesystemNodePaths({
    workspaceId,
    workspacePath,
    nodesRef,
    spacesRef,
    onShowMessage,
  })
  const lifetime = useRef<object | null>(null)
  useLayoutEffect(() => {
    lifetime.current = {}
    return () => {
      lifetime.current = null
    }
  }, [workspaceId])

  const materialize = useCallback(
    async (
      entry: FilesystemEntryDragData,
      anchor: Point,
      isSourceCurrent: () => boolean = () => true,
      options: FilesystemMaterializeOptions = {},
    ) => {
      const epoch = lifetime.current
      const isCurrent = () => epoch !== null && lifetime.current === epoch && isSourceCurrent()
      try {
        const binding = await resolveFilesystemEntryBinding(entry.mountId, entry.rootUri)
        if (!isCurrent()) {
          return
        }
        if (!binding) {
          throw new Error(t('documentNode.filesystemUnavailable'))
        }
        const filesystem = resolveFilesystemApiForMount(entry.mountId)
        if (!filesystem) {
          throw new Error(t('documentNode.filesystemUnavailable'))
        }
        const stat = await filesystem.stat({ uri: entry.uri })
        if (!isCurrent()) {
          return
        }
        if (stat.kind !== entry.kind) {
          return
        }
        const target =
          options.targetSpaceId === undefined
            ? findContainingSpaceByAnchor(spacesRef.current, anchor)
            : (spacesRef.current.find(space => space.id === options.targetSpaceId) ?? null)
        if (options.targetSpaceId && !target) {
          return
        }
        const compactSize = getCollapsedNodeSize()
        const placement = { targetSpaceRect: target?.rect ?? null, focusViewportOnCreate: false }
        const compactAnchor = {
          x: anchor.x - compactSize.width / 2,
          y: anchor.y - compactSize.height / 2,
        }
        const node =
          entry.kind === 'directory'
            ? createFolderNode(
                compactAnchor,
                {
                  uri: entry.uri,
                  rootUri: entry.rootUri,
                  viewMode: 'icons',
                  expandedDirectoryUris: [],
                },
                binding,
                workspaceId,
                placement,
              )
            : options.collapsed
              ? createDocumentNode(compactAnchor, { uri: entry.uri }, placement, binding, {
                  workspaceId,
                  collapsed: true,
                })
              : createDocumentNode(anchor, { uri: entry.uri }, placement, binding)
        if (!node) {
          return
        }
        if (target) {
          assignNodeToSpaceAndExpand({
            workspaceId,
            createdNodeId: node.id,
            createdNode: node,
            targetSpaceId: target.id,
            spacesRef,
            nodesRef,
            setNodes,
            onSpacesChange,
          })
        }
        onRequestPersistFlush?.()
      } catch (error) {
        if (isCurrent()) {
          onShowMessage?.(
            t('spaceExplorer.openFailed', { message: toErrorMessage(error) }),
            'error',
          )
        }
      }
    },
    [
      createDocumentNode,
      createFolderNode,
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      setNodes,
      spacesRef,
      t,
      workspaceId,
    ],
  )

  const updateFolder = useCallback(
    (id: string, next: FolderNodeData) => {
      const normalized = normalizeFolderNodeData(next)
      const current = nodesRef.current.find(node => node.id === id)
      if (
        !normalized ||
        current?.data.kind !== 'folder' ||
        current.data.folder?.rootUri !== normalized.rootUri
      ) {
        return
      }
      guardNodeFromSyncOverwrite(id)
      setNodes(
        previous =>
          previous.map(node => {
            if (
              node.id !== id ||
              node.data.kind !== 'folder' ||
              node.data.folder?.rootUri !== normalized.rootUri
            ) {
              return node
            }
            return {
              ...node,
              data: { ...node.data, folder: normalized, title: resolveFileUriName(normalized.uri) },
            }
          }),
        { syncLayout: false },
      )
      onRequestPersistFlush?.()
    },
    [nodesRef, onRequestPersistFlush, setNodes],
  )

  const openFile = useCallback(
    (id: string, uri: string) => {
      const node = nodesRef.current.find(item => item.id === id)
      const folder = node?.data.folder
      if (!node || !folder || !isFileUriWithinRoot(folder.rootUri, uri)) {
        return
      }
      const mountId = resolveFilesystemNodeMountId(id, node.data, spacesRef.current)
      if (mountId === undefined) {
        return
      }
      const entry: FilesystemEntryDragData = {
        version: 1,
        kind: 'file',
        uri,
        rootUri: folder.rootUri,
        mountId,
      }
      void materialize(
        entry,
        { x: node.position.x + node.data.width + 24, y: node.position.y },
        () => {
          const current = nodesRef.current.find(item => item.id === id)
          return (
            current?.data.folder?.uri === folder.uri &&
            resolveFilesystemNodeMountId(id, current.data, spacesRef.current) === mountId
          )
        },
      )
    },
    [materialize, nodesRef, spacesRef],
  )

  const findBlockingOpenDocument = useCallback(
    (id: string, uri: string) => {
      const folder = nodesRef.current.find(item => item.id === id)
      if (!folder) {
        return null
      }
      const mountId = resolveFilesystemNodeMountId(id, folder.data, spacesRef.current)
      return findBlockingOpenDocumentForMutation(
        nodesRef.current.filter(
          node => resolveFilesystemNodeMountId(node.id, node.data, spacesRef.current) === mountId,
        ),
        uri,
      )
    },
    [nodesRef, spacesRef],
  )

  const handleDragOver = useCallback<DragEventHandler<HTMLDivElement>>(event => {
    if (
      !hasFilesystemEntryDragData(event.dataTransfer) ||
      !isFilesystemCanvasDropTarget(event.target)
    ) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])
  const handleDrop = useCallback<DragEventHandler<HTMLDivElement>>(
    event => {
      if (!isFilesystemCanvasDropTarget(event.target)) {
        return
      }
      const entry = readFilesystemEntryDragData(event.dataTransfer)
      if (!entry) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void materialize(
        entry,
        reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      )
    },
    [materialize, reactFlow],
  )
  const actions = useMemo(
    () => ({
      updateFolder,
      openFile,
      findBlockingOpenDocument,
      onShowMessage,
      getNodePathUri,
      copyNodePath,
    }),
    [updateFolder, openFile, findBlockingOpenDocument, onShowMessage, getNodePathUri, copyNodePath],
  )
  const nativeDrop = useNativeFilesystemDrop({ workspaceId, spacesRef, materialize, onShowMessage })
  return { actions, handleDragOver, handleDrop, ...nativeDrop }
}
