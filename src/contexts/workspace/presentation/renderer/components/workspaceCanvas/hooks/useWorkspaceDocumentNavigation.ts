import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalFileLinkOpenRequest } from '@shared/types/terminalLinkNavigation'
import {
  resolveDocumentNavigationDestination,
  type DocumentNavigationIntent,
} from '../../../../../domain/documentNavigation'
import type { WorkspaceDocumentNavigation } from '../WorkspaceDocumentNavigationContext'
import { resolveFilesystemNodeMountId } from '../filesystemNodeBinding'
import {
  useWorkspaceDocumentOpening,
  type WorkspaceDocumentOpeningArgs,
} from './useWorkspaceDocumentOpening'

export function useWorkspaceDocumentNavigation(
  options: WorkspaceDocumentOpeningArgs & {
    workspaceId: string
    openSpaceExplorer: (spaceId: string) => void
    openExplorerSpaceId: string | null
  },
): WorkspaceDocumentNavigation {
  const { nodesRef, spacesRef, openSpaceExplorer, openExplorerSpaceId, workspaceId } = options
  const openDocument = useWorkspaceDocumentOpening(options)
  const [navigationByNode, setNavigationByNode] = useState<
    ReadonlyMap<string, DocumentNavigationIntent>
  >(() => new Map())
  const [directoryTarget, setDirectoryTarget] =
    useState<WorkspaceDocumentNavigation['directoryTarget']>(null)
  const nextRequestRef = useRef(0)
  const requestsBySource = useRef(new Map<string, number>())
  const aliveRef = useRef(true)
  const activeWorkspaceRef = useRef(workspaceId)
  activeWorkspaceRef.current = workspaceId
  const nodes = nodesRef.current
  const spaces = spacesRef.current
  useEffect(() => {
    aliveRef.current = true
    setNavigationByNode(new Map())
    setDirectoryTarget(null)
    requestsBySource.current.clear()
    return () => {
      aliveRef.current = false
    }
  }, [workspaceId])
  useEffect(() => {
    const sourceIds = new Set(nodes.map(node => node.id))
    for (const nodeId of requestsBySource.current.keys()) {
      if (!sourceIds.has(nodeId)) {
        requestsBySource.current.delete(nodeId)
      }
    }
    setNavigationByNode(previous => {
      const next = new Map(previous)
      for (const [nodeId, intent] of next) {
        const node = nodes.find(candidate => candidate.id === nodeId)
        if (
          node?.data.document?.uri !== intent.uri ||
          !node ||
          resolveFilesystemNodeMountId(node.id, node.data, spaces) !== intent.mountId
        ) {
          next.delete(nodeId)
        }
      }
      return next.size === previous.size ? previous : next
    })
  }, [nodes, spaces])
  useEffect(() => {
    if (!directoryTarget) {
      return
    }
    const space = spaces.find(candidate => candidate.id === directoryTarget.spaceId)
    if (
      openExplorerSpaceId !== directoryTarget.spaceId ||
      !space ||
      (space.targetMountId ?? null) !== directoryTarget.mountId
    ) {
      setDirectoryTarget(null)
    }
  }, [directoryTarget, openExplorerSpaceId, spaces])

  const acknowledgeNavigation = useCallback((nodeId: string, requestId: number) => {
    setNavigationByNode(previous => {
      if (previous.get(nodeId)?.requestId !== requestId) {
        return previous
      }
      const next = new Map(previous)
      next.delete(nodeId)
      return next
    })
  }, [])

  const openFileLink = useCallback(
    async (sourceNodeId: string, request: TerminalFileLinkOpenRequest): Promise<boolean> => {
      const source = nodesRef.current.find(node => node.id === sourceNodeId)
      if (
        !aliveRef.current ||
        activeWorkspaceRef.current !== workspaceId ||
        !source ||
        (source.data.workerBinding?.mountId ?? null) !== request.mountId ||
        (source.data.workerBinding?.endpointId !== undefined &&
          source.data.workerBinding.endpointId !== 'local' &&
          !request.mountId)
      ) {
        return false
      }
      const destination = resolveDocumentNavigationDestination(
        spacesRef.current,
        sourceNodeId,
        request.mountId,
      )
      if (!destination) {
        return false
      }
      const requestId = ++nextRequestRef.current
      const sourceSessionId = source.data.sessionId
      const sourceEndpointId = source.data.workerBinding?.endpointId ?? 'local'
      requestsBySource.current.set(sourceNodeId, requestId)
      const isRequestCurrent = () => {
        const current = nodesRef.current.find(node => node.id === sourceNodeId)
        const currentDestination = resolveDocumentNavigationDestination(
          spacesRef.current,
          sourceNodeId,
          request.mountId,
        )
        return (
          aliveRef.current &&
          activeWorkspaceRef.current === workspaceId &&
          requestsBySource.current.get(sourceNodeId) === requestId &&
          current?.data.sessionId === sourceSessionId &&
          (current?.data.workerBinding?.endpointId ?? 'local') === sourceEndpointId &&
          (current?.data.workerBinding?.mountId ?? null) === request.mountId &&
          currentDestination?.spaceId === destination.spaceId
        )
      }
      if (request.kind === 'directory') {
        if (!destination.spaceId) {
          return false
        }
        setDirectoryTarget({
          spaceId: destination.spaceId,
          mountId: request.mountId,
          uri: request.uri,
        })
        openSpaceExplorer(destination.spaceId)
        return true
      }
      const space = spacesRef.current.find(candidate => candidate.id === destination.spaceId)
      const opened = await openDocument({
        ...destination,
        uri: request.uri,
        mountId: request.mountId,
        anchor: space?.rect
          ? { x: space.rect.x + 24, y: space.rect.y + 46 }
          : { x: source.position.x + source.data.width + 24, y: source.position.y },
        placement: { preferredDirection: 'right' },
        isRequestCurrent,
      })
      if (!opened || !isRequestCurrent()) {
        return false
      }
      const currentDocument = nodesRef.current.find(node => node.id === opened.id)
      if (
        currentDocument?.data.document?.uri !== request.uri ||
        !currentDocument ||
        resolveFilesystemNodeMountId(
          currentDocument.id,
          currentDocument.data,
          spacesRef.current,
        ) !== request.mountId
      ) {
        return false
      }
      const intent: DocumentNavigationIntent = {
        requestId,
        uri: request.uri,
        mountId: request.mountId,
        line: request.line,
        column: request.column,
        lineEnd: request.lineEnd,
        columnEnd: request.columnEnd,
      }
      setNavigationByNode(previous =>
        (previous.get(opened.id)?.requestId ?? 0) > requestId
          ? previous
          : new Map(previous).set(opened.id, intent),
      )
      return true
    },
    [openDocument, nodesRef, openSpaceExplorer, spacesRef, workspaceId],
  )

  return useMemo(
    () => ({ openFileLink, navigationByNode, acknowledgeNavigation, directoryTarget }),
    [openFileLink, navigationByNode, acknowledgeNavigation, directoryTarget],
  )
}
