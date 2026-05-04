import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import {
  DEFAULT_AGENT_SETTINGS,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { resolveTerminalPtyGeometryForNodeFrame } from '@contexts/workspace/domain/terminalPtyGeometry'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { Point, TerminalNodeData, WebsiteNodeData, WorkspaceSpaceState } from '../../../types'
import type { SpawnTerminalResult } from '@shared/contracts/dto'
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
import {
  resolveDefaultMountFallback,
  resolveTerminalLaunchWorkspaceContext,
} from './useInteractions.paneNodeCreation.terminalLaunch'
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
  terminalFontSize = DEFAULT_AGENT_SETTINGS.terminalFontSize,
  workspacePath,
  environmentVariables,
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
  terminalFontSize?: number
  workspacePath: string
  environmentVariables?: Record<string, string>
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
  const launchGeometry = resolveTerminalPtyGeometryForNodeFrame({
    ...resolveDefaultTerminalWindowSize(standardWindowSizeBucket),
    terminalFontSize,
  })

  let targetSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)
  const launchWorkspaceContext = await resolveTerminalLaunchWorkspaceContext({
    anchor: cursorAnchor,
    workspaceId,
    workspacePath,
    targetSpace,
  })
  targetSpace = launchWorkspaceContext.targetSpace
  const resolvedWorkspacePath = launchWorkspaceContext.workspacePath
  let resolvedCwd = resolveSpaceWorkingDirectory(targetSpace, resolvedWorkspacePath)
  let mountId = targetSpace?.targetMountId ?? null

  if (!mountId && !targetSpace) {
    try {
      const defaultMountFallback = await resolveDefaultMountFallback({
        workspaceId,
        workspacePath: resolvedWorkspacePath,
      })
      if (defaultMountFallback) {
        mountId = defaultMountFallback.mountId
        resolvedCwd = defaultMountFallback.rootPath
      }
    } catch (error) {
      onShowMessage?.(
        translate('messages.mountListFailed', { message: toErrorMessage(error) }),
        'error',
      )
      return null
    }
  }

  const spawnCwdUri =
    mountId && targetSpace?.targetMountId && targetSpace.directoryPath.trim().length > 0
      ? toFileUri(targetSpace.directoryPath.trim())
      : null

  const nodeWorkingDirectory = resolvedCwd

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
            cols: launchGeometry.cols,
            rows: launchGeometry.rows,
            ...(environmentVariables && Object.keys(environmentVariables).length > 0
              ? { env: environmentVariables }
              : {}),
          },
        })
      : await window.opencoveApi.pty.spawn({
          cwd: resolvedCwd,
          profileId: defaultTerminalProfileId ?? undefined,
          cols: launchGeometry.cols,
          rows: launchGeometry.rows,
          ...(environmentVariables && Object.keys(environmentVariables).length > 0
            ? { env: environmentVariables }
            : {}),
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
    terminalGeometry: launchGeometry,
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
  environmentVariables,
  spacesRef,
  nodesRef,
  standardWindowSizeBucket,
  terminalFontSize,
  setNodes,
  onSpacesChange,
  createNodeForSession,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  defaultTerminalProfileId: string | null
  workspacePath: string
  environmentVariables?: Record<string, string>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  standardWindowSizeBucket: StandardWindowSizeBucket
  terminalFontSize?: number
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
    terminalFontSize,
    workspacePath,
    environmentVariables,
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
