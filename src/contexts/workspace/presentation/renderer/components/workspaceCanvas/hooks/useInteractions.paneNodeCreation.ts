import { resolvePaneNodeCreationAnchor } from './useInteractions.creationAnchor'
import type { Node } from '@xyflow/react'
import {
  DEFAULT_AGENT_SETTINGS,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { isAllocateProjectPlaceholderPath } from '@app/renderer/shell/utils/projectPlaceholderPath'
import {
  resolveTerminalPtyGeometryForNodeFrame,
  type TerminalPtyGeometryDisplayMetrics,
} from '@contexts/workspace/domain/terminalPtyGeometry'
import { toFileUri } from '@contexts/filesystem/domain'
import type { Point, TerminalNodeData, WebsiteNodeData, WorkspaceSpaceState } from '../../../types'
import type { BrowserMode, SpawnTerminalResult } from '@shared/contracts/dto'
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
import { resolveTerminalLaunchWorkspaceContext } from './useInteractions.paneNodeCreation.terminalLaunch'
import { resolveSpaceMountLaunchContext } from './spaceMountLaunchContext'
import {
  resolveControlSurfaceInvoke,
  shouldUseControlSurfacePlainRuntime,
} from './useWorkspaceRuntimeLaunchRouting'
import { translate } from '@app/renderer/i18n'
import { createWebsiteNodeData } from '../../../utils/websiteNodeData'
import { nodeWorkerBindingForMount } from '@shared/types/nodeWorkerBinding'
import type { CanvasUiCommands } from '../../../store/canvasStore.ui'
import type { CanvasDocumentCommands } from '../../../store/canvasStoreContext'
import type { WorkspaceDocument } from '../../../store/workspaceDocument'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

type UpdateCanvasDocument = UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']

export async function createTerminalNodeAtFlowPosition({
  anchor,
  workspaceId,
  defaultTerminalProfileId,
  standardWindowSizeBucket,
  terminalFontSize = DEFAULT_AGENT_SETTINGS.terminalFontSize,
  terminalDisplayMetrics,
  workspacePath,
  environmentVariables,
  readDocument,
  updateCanvasDocument,
  updateSpaces,
  createNodeForSession,
  onShowMessage,
  title,
}: {
  anchor: Point
  workspaceId: string
  defaultTerminalProfileId: string | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  terminalFontSize?: number
  terminalDisplayMetrics?: TerminalPtyGeometryDisplayMetrics | null
  workspacePath: string
  environmentVariables?: Record<string, string>
  readDocument: () => WorkspaceDocument
  updateCanvasDocument: UpdateCanvasDocument
  updateSpaces: CanvasDocumentCommands['updateSpaces']
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
    displayMetrics: terminalDisplayMetrics,
  })

  let targetSpace = findContainingSpaceByAnchor(readDocument().spaces, cursorAnchor)
  const targetSpaceBaseline = targetSpace
  const launchWorkspaceContext = await resolveTerminalLaunchWorkspaceContext({
    anchor: cursorAnchor,
    workspaceId,
    workspacePath,
    targetSpace,
  })
  targetSpace = launchWorkspaceContext.targetSpace
  const workspaceSpacesSnapshot = launchWorkspaceContext.workspaceSpacesSnapshot
  const resolvedWorkspacePath = launchWorkspaceContext.workspacePath
  const shouldFallbackToFirstMount =
    !targetSpace && isAllocateProjectPlaceholderPath(resolvedWorkspacePath, workspaceId)
  // The repair writes after `mount.list` answers, onto the Spaces the store holds then. A target
  // that only the persisted snapshot holds is added by the same write. It does not flush: the node
  // add after the spawn does.
  const repairSpaceId = targetSpace?.id
  let mountId: string | null = null
  let workerBinding = nodeWorkerBindingForMount(null)
  let resolvedCwd = resolvedWorkspacePath

  try {
    const mountContext = await resolveSpaceMountLaunchContext({
      workspaceId,
      workspacePath: resolvedWorkspacePath,
      space: targetSpace,
      commitSpaceRepair:
        repairSpaceId === undefined
          ? undefined
          : recipe =>
              updateSpaces(spaces =>
                recipe(mergeMissingWorkspaceSpaces(spaces, workspaceSpacesSnapshot, repairSpaceId)),
              ),
      fallbackToFirstMount: shouldFallbackToFirstMount,
    })
    targetSpace = mountContext.space
    mountId = mountContext.mountId
    workerBinding = nodeWorkerBindingForMount(mountContext.mount)
    resolvedCwd = mountContext.workingDirectory
  } catch (error) {
    onShowMessage?.(
      translate('messages.mountListFailed', { message: toErrorMessage(error) }),
      'error',
    )
    return null
  }

  const spawnCwdUri =
    mountId && resolvedCwd.trim().length > 0 ? toFileUri(resolvedCwd.trim()) : null

  const nodeWorkingDirectory = resolvedCwd
  const controlSurfaceInvoke = resolveControlSurfaceInvoke()
  const shouldUseControlSurfacePlainSpawn =
    !mountId &&
    controlSurfaceInvoke !== null &&
    shouldUseControlSurfacePlainRuntime({
      workspacePath: resolvedWorkspacePath,
      executionDirectory: resolvedCwd,
    })

  const canvasNodeId = crypto.randomUUID()
  let spawned: SpawnTerminalResult

  try {
    spawned = mountId
      ? await window.opencoveApi.controlSurface.invoke<SpawnTerminalResult>({
          kind: 'command',
          id: 'pty.spawnInMount',
          payload: {
            canvasNodeId,
            workspaceId,
            spaceId: targetSpace?.id,
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
      : shouldUseControlSurfacePlainSpawn
        ? await controlSurfaceInvoke<SpawnTerminalResult>({
            kind: 'command',
            id: 'pty.spawn',
            payload: {
              canvasNodeId,
              spaceId: targetSpace?.id,
              cwd: resolvedCwd,
              workspaceId,
              profileId: defaultTerminalProfileId,
              cols: launchGeometry.cols,
              rows: launchGeometry.rows,
              ...(environmentVariables && Object.keys(environmentVariables).length > 0
                ? { env: environmentVariables }
                : {}),
            },
          })
        : await window.opencoveApi.pty.spawn({
            canvasNodeId,
            spaceId: targetSpace?.id,
            cwd: resolvedCwd,
            workspaceId,
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
      : `terminal-${readDocument().nodes.length + 1}`

  const created = await createNodeForSession({
    nodeId: canvasNodeId,
    sessionId: spawned.sessionId,
    profileId: spawned.profileId,
    runtimeKind: spawned.runtimeKind,
    terminalGeometry: launchGeometry,
    standardWindowSizeBucket,
    workerBinding,
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
      workspaceId,
      createdNodeId: created.id,
      targetSpaceId: targetSpace.id,
      targetSpaceSnapshot: targetSpace,
      targetSpaceBaseline,
      workspaceSpacesSnapshot,
      updateCanvasDocument,
    })
  }

  return { sessionId: spawned.sessionId, nodeId: created.id }
}

function mergeMissingWorkspaceSpaces(
  spaces: WorkspaceSpaceState[],
  workspaceSpacesSnapshot: WorkspaceSpaceState[] | null,
  requiredSpaceId: string,
): WorkspaceSpaceState[] {
  if (!workspaceSpacesSnapshot?.some(space => space.id === requiredSpaceId)) {
    return spaces
  }

  const existingSpaceIds = new Set(spaces.map(space => space.id))
  if (existingSpaceIds.has(requiredSpaceId)) {
    return spaces
  }

  return [...spaces, ...workspaceSpacesSnapshot.filter(space => !existingSpaceIds.has(space.id))]
}

export function createNoteNodeAtFlowPosition({
  workspaceId,
  anchor,
  standardWindowSizeBucket,
  createNoteNode,
  readDocument,
  updateCanvasDocument,
}: {
  workspaceId?: string
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
  readDocument: () => WorkspaceDocument
  updateCanvasDocument: UpdateCanvasDocument
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
    workspaceId,
    anchor: nodeAnchor,
    spaceAnchor: cursorAnchor,
    createNoteNode,
    readDocument,
    updateCanvasDocument,
  })
}

export function createWebsiteNodeAtFlowPosition({
  workspaceId,
  anchor,
  standardWindowSizeBucket,
  browserDefaultMode,
  url,
  createWebsiteNode,
  readDocument,
  updateCanvasDocument,
}: {
  workspaceId?: string
  anchor: Point
  standardWindowSizeBucket: StandardWindowSizeBucket
  browserDefaultMode: BrowserMode
  url: string
  createWebsiteNode: (
    anchor: Point,
    website: WebsiteNodeData,
    placement?: NodePlacementOptions,
  ) => Node<TerminalNodeData> | null
  readDocument: () => WorkspaceDocument
  updateCanvasDocument: UpdateCanvasDocument
}): void {
  const cursorAnchor = {
    x: anchor.x,
    y: anchor.y,
  }
  const nodeAnchor = resolveNodePlacementAnchorFromViewportCenter(
    cursorAnchor,
    resolveDefaultWebsiteWindowSize(standardWindowSizeBucket),
  )

  const targetSpace = findContainingSpaceByAnchor(readDocument().spaces, cursorAnchor)

  const created = createWebsiteNode(
    nodeAnchor,
    createWebsiteNodeData({
      url,
      browserMode: browserDefaultMode,
      pinned: false,
      sessionMode: 'shared',
      profileId: null,
    }),
    {
      targetSpaceRect: targetSpace?.rect ?? null,
    },
  )

  if (!created || !targetSpace) {
    return
  }

  assignNodeToSpaceAndExpand({
    workspaceId,
    createdNodeId: created.id,
    targetSpaceId: targetSpace.id,
    updateCanvasDocument,
  })
}

type PaneCreationOptions<T> = Omit<T, 'anchor'> & {
  contextMenu: ContextMenuState | null
  ui: CanvasUiCommands
}

export function createWebsiteNodeFromPaneContextMenu({
  contextMenu,
  ui,
  ...options
}: PaneCreationOptions<Parameters<typeof createWebsiteNodeAtFlowPosition>[0]>): void {
  if (!contextMenu || contextMenu.kind !== 'pane') {
    return
  }
  ui.closeContextMenu()
  createWebsiteNodeAtFlowPosition({
    ...options,
    anchor: resolvePaneNodeCreationAnchor(contextMenu),
  })
}

export function createNoteNodeFromPaneContextMenu({
  contextMenu,
  ui,
  ...options
}: PaneCreationOptions<Parameters<typeof createNoteNodeAtFlowPosition>[0]>): void {
  if (!contextMenu || contextMenu.kind !== 'pane') {
    return
  }
  ui.closeContextMenu()
  createNoteNodeAtFlowPosition({ ...options, anchor: resolvePaneNodeCreationAnchor(contextMenu) })
}
