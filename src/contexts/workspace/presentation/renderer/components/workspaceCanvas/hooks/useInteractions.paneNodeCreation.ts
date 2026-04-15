import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { Point, TerminalNodeData, WebsiteNodeData, WorkspaceSpaceState } from '../../../types'
import type { ListMountsResult, SpawnTerminalResult } from '@shared/contracts/dto'
import type { ContextMenuState, CreateNodeInput, NodePlacementOptions } from '../types'
import {
  resolveDefaultNoteWindowSize,
  resolveDefaultTerminalWindowSize,
  resolveDefaultWebsiteWindowSize,
} from '../constants'
import { resolveNodePlacementAnchorFromViewportCenter, toErrorMessage } from '../helpers'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'
import { createNoteNodeAtAnchor } from './useInteractions.noteCreation'
import { translate } from '@app/renderer/i18n'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export async function createTerminalNodeAtFlowPosition({
  anchor,
  workspaceId,
  defaultTerminalProfileId,
  standardWindowSizeBucket,
  workspacePath,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  createNodeForSession,
  onShowMessage,
  title,
}: {
  anchor: Point
  workspaceId: string
  defaultTerminalProfileId: string | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  workspacePath: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
  title?: string | null
}): Promise<{ sessionId: string; nodeId: string } | null> {
  const cursorAnchor = {
    x: anchor.x,
    y: anchor.y,
  }
  const nodeAnchor = resolveNodePlacementAnchorFromViewportCenter(
    cursorAnchor,
    resolveDefaultTerminalWindowSize(standardWindowSizeBucket),
  )

  const targetSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)

  const resolvedCwd = resolveSpaceWorkingDirectory(targetSpace, workspacePath)

  let mountId = targetSpace?.targetMountId ?? null
  let defaultMountRootPath: string | null = null
  if (!mountId && !targetSpace && workspaceId.trim().length > 0) {
    const controlSurfaceInvoke = (
      window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
    ).opencoveApi?.controlSurface?.invoke

    if (typeof controlSurfaceInvoke === 'function') {
      try {
        const mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
          kind: 'query',
          id: 'mount.list',
          payload: { projectId: workspaceId },
        })

        const defaultMount = mountResult.mounts[0] ?? null
        mountId = defaultMount?.mountId ?? null
        defaultMountRootPath = defaultMount?.rootPath ?? null
      } catch (error) {
        // If we can't resolve mounts, keep the legacy local behavior (workspacePath cwd).
        // This preserves backwards compatibility for projects created before mounts existed.
        onShowMessage?.(
          translate('messages.mountListFailed', { message: toErrorMessage(error) }),
          'error',
        )
      }
    }
  }

  const spawnCwdUri =
    mountId && targetSpace?.targetMountId && targetSpace.directoryPath.trim().length > 0
      ? toFileUri(targetSpace.directoryPath.trim())
      : null

  const nodeWorkingDirectory = mountId
    ? spawnCwdUri
      ? resolvedCwd
      : (defaultMountRootPath ?? resolvedCwd)
    : resolvedCwd

  let spawned: SpawnTerminalResult

  try {
    spawned = mountId
      ? await window.opencoveApi.controlSurface.invoke<SpawnTerminalResult>({
          kind: 'command',
          id: 'pty.spawnInMount',
          payload: {
            mountId,
            cwdUri: spawnCwdUri,
            profileId: defaultTerminalProfileId,
            cols: 80,
            rows: 24,
          },
        })
      : await window.opencoveApi.pty.spawn({
          cwd: resolvedCwd,
          profileId: defaultTerminalProfileId ?? undefined,
          cols: 80,
          rows: 24,
        })
  } catch (error) {
    onShowMessage?.(
      translate('messages.terminalLaunchFailed', { message: toErrorMessage(error) }),
      'error',
    )
    return null
  }

  const resolvedTitle =
    typeof title === 'string' && title.trim().length > 0
      ? title.trim()
      : `terminal-${nodesRef.current.length + 1}`

  const created = await createNodeForSession({
    sessionId: spawned.sessionId,
    profileId: spawned.profileId,
    runtimeKind: spawned.runtimeKind,
    title: resolvedTitle,
    anchor: nodeAnchor,
    kind: 'terminal',
    executionDirectory: nodeWorkingDirectory,
    expectedDirectory: nodeWorkingDirectory,
    placement: {
      targetSpaceRect: targetSpace?.rect ?? null,
    },
  })

  if (!created) {
    return null
  }

  if (targetSpace) {
    assignNodeToSpaceAndExpand({
      createdNodeId: created.id,
      targetSpaceId: targetSpace.id,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
    })
  }

  return { sessionId: spawned.sessionId, nodeId: created.id }
}

export function createNoteNodeAtFlowPosition({
  anchor,
  standardWindowSizeBucket,
  createNoteNode,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
}: {
  anchor: Point
  standardWindowSizeBucket: StandardWindowSizeBucket
  createNoteNode: (
    anchor: Point,
    options?: {
      placement?: {
        targetSpaceRect?: WorkspaceSpaceState['rect']
      }
    },
  ) => Node<TerminalNodeData> | null
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
}): void {
  const cursorAnchor = {
    x: anchor.x,
    y: anchor.y,
  }
  const nodeAnchor = resolveNodePlacementAnchorFromViewportCenter(
    cursorAnchor,
    resolveDefaultNoteWindowSize(standardWindowSizeBucket),
  )

  createNoteNodeAtAnchor({
    anchor: nodeAnchor,
    spaceAnchor: cursorAnchor,
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}

export function createWebsiteNodeAtFlowPosition({
  anchor,
  standardWindowSizeBucket,
  url,
  createWebsiteNode,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
}: {
  anchor: Point
  standardWindowSizeBucket: StandardWindowSizeBucket
  url: string
  createWebsiteNode: (
    anchor: Point,
    website: WebsiteNodeData,
    placement?: NodePlacementOptions,
  ) => Node<TerminalNodeData> | null
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
}): void {
  const cursorAnchor = {
    x: anchor.x,
    y: anchor.y,
  }
  const nodeAnchor = resolveNodePlacementAnchorFromViewportCenter(
    cursorAnchor,
    resolveDefaultWebsiteWindowSize(standardWindowSizeBucket),
  )

  const targetSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)

  const created = createWebsiteNode(
    nodeAnchor,
    {
      url,
      pinned: false,
      sessionMode: 'shared',
      profileId: null,
    },
    {
      targetSpaceRect: targetSpace?.rect ?? null,
    },
  )

  if (!created || !targetSpace) {
    return
  }

  assignNodeToSpaceAndExpand({
    createdNodeId: created.id,
    targetSpaceId: targetSpace.id,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}

export async function createTerminalNodeFromPaneContextMenu({
  contextMenu,
  defaultTerminalProfileId,
  workspacePath,
  spacesRef,
  nodesRef,
  standardWindowSizeBucket,
  setNodes,
  onSpacesChange,
  createNodeForSession,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  defaultTerminalProfileId: string | null
  workspacePath: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  standardWindowSizeBucket: StandardWindowSizeBucket
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  setContextMenu: (next: ContextMenuState | null) => void
}): Promise<void> {
  if (!contextMenu || contextMenu.kind !== 'pane') {
    return
  }

  setContextMenu(null)
  await createTerminalNodeAtFlowPosition({
    anchor: {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    },
    workspaceId: '',
    defaultTerminalProfileId,
    standardWindowSizeBucket,
    workspacePath,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    createNodeForSession,
  })
}

export function createWebsiteNodeFromPaneContextMenu({
  contextMenu,
  url,
  createWebsiteNode,
  standardWindowSizeBucket,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  url: string
  createWebsiteNode: (
    anchor: Point,
    website: WebsiteNodeData,
    placement?: NodePlacementOptions,
  ) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  setContextMenu: (next: ContextMenuState | null) => void
}): void {
  if (!contextMenu || contextMenu.kind !== 'pane') {
    return
  }

  setContextMenu(null)
  createWebsiteNodeAtFlowPosition({
    anchor: {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    },
    url,
    standardWindowSizeBucket,
    createWebsiteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}

export function createNoteNodeFromPaneContextMenu({
  contextMenu,
  createNoteNode,
  standardWindowSizeBucket,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  createNoteNode: (anchor: Point) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  setContextMenu: (next: ContextMenuState | null) => void
}): void {
  if (!contextMenu || contextMenu.kind !== 'pane') {
    return
  }

  setContextMenu(null)
  createNoteNodeAtFlowPosition({
    anchor: {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    },
    standardWindowSizeBucket,
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}
