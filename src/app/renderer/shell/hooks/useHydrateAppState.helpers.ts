import type { Node } from '@xyflow/react'
import type {
  PersistedWorkspaceState,
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { sanitizeWorkspaceSpaces } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { hydrateAgentNode } from '@contexts/agent/presentation/renderer/hydrateAgentNode'

export function toShellWorkspaceState(
  workspace: PersistedWorkspaceState,
  options?: { dropRuntimeSessionIds?: boolean },
): WorkspaceState {
  const dropRuntimeSessionIds = options?.dropRuntimeSessionIds === true
  const nodes = dropRuntimeSessionIds
    ? toRuntimeNodes(workspace).map(node => {
        if (node.data.kind !== 'terminal' && node.data.kind !== 'agent') {
          return node
        }

        return {
          ...node,
          data: {
            ...node.data,
            sessionId: '',
          },
        }
      })
    : toRuntimeNodes(workspace)
  const validNodeIds = new Set(nodes.map(node => node.id))
  const sanitizedSpaces = sanitizeWorkspaceSpaces(
    workspace.spaces.map(space => ({
      ...space,
      nodeIds: space.nodeIds.filter(nodeId => validNodeIds.has(nodeId)),
    })),
  )
  const hasActiveSpace =
    workspace.activeSpaceId !== null &&
    sanitizedSpaces.some(space => space.id === workspace.activeSpaceId)

  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    worktreesRoot: workspace.worktreesRoot,
    pullRequestBaseBranchOptions: workspace.pullRequestBaseBranchOptions ?? [],
    nodes,
    viewport: {
      x: workspace.viewport.x,
      y: workspace.viewport.y,
      zoom: workspace.viewport.zoom,
    },
    isMinimapVisible: workspace.isMinimapVisible,
    spaces: sanitizedSpaces,
    activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
    spaceArchiveRecords: workspace.spaceArchiveRecords,
  }
}

export function requiresRuntimeHydration(node: Node<TerminalNodeData>): boolean {
  return node.data.kind === 'terminal' || node.data.kind === 'agent'
}

function mergeHydratedAgentData(
  currentAgent: TerminalNodeData['agent'],
  hydratedAgent: TerminalNodeData['agent'],
): TerminalNodeData['agent'] {
  if (!currentAgent || !hydratedAgent) {
    return hydratedAgent
  }

  return {
    ...currentAgent,
    provider: hydratedAgent.provider,
    prompt: hydratedAgent.prompt,
    model: hydratedAgent.model,
    effectiveModel: hydratedAgent.effectiveModel,
    launchMode: hydratedAgent.launchMode,
    resumeSessionId: hydratedAgent.resumeSessionId,
    resumeSessionIdVerified: hydratedAgent.resumeSessionIdVerified,
  }
}

export function mergeHydratedNode(
  currentNode: Node<TerminalNodeData>,
  hydratedNode: Node<TerminalNodeData>,
): Node<TerminalNodeData> {
  if (currentNode.id !== hydratedNode.id) {
    return currentNode
  }

  return {
    ...currentNode,
    data: {
      ...currentNode.data,
      kind: hydratedNode.data.kind,
      title: hydratedNode.data.kind === 'agent' ? hydratedNode.data.title : currentNode.data.title,
      sessionId: hydratedNode.data.sessionId,
      profileId: hydratedNode.data.profileId ?? currentNode.data.profileId ?? null,
      runtimeKind: hydratedNode.data.runtimeKind ?? currentNode.data.runtimeKind,
      status: hydratedNode.data.status,
      startedAt: hydratedNode.data.startedAt,
      endedAt: hydratedNode.data.endedAt,
      exitCode: hydratedNode.data.exitCode,
      lastError: hydratedNode.data.lastError,
      scrollback: hydratedNode.data.scrollback,
      agent: mergeHydratedAgentData(currentNode.data.agent, hydratedNode.data.agent),
      task: hydratedNode.data.task ?? currentNode.data.task,
      note: hydratedNode.data.note ?? currentNode.data.note,
    },
  }
}

export function resolveTerminalHydrationCwd(
  node: Node<TerminalNodeData>,
  workspacePath: string,
): string {
  if (node.data.kind !== 'terminal') {
    return workspacePath
  }

  const executionDirectory =
    typeof node.data.executionDirectory === 'string' ? node.data.executionDirectory.trim() : ''
  if (executionDirectory.length > 0) {
    return executionDirectory
  }

  const expectedDirectory =
    typeof node.data.expectedDirectory === 'string' ? node.data.expectedDirectory.trim() : ''
  if (expectedDirectory.length > 0) {
    return expectedDirectory
  }

  return workspacePath
}

export async function hydrateRuntimeNode({
  node,
  workspacePath,
  agentFullAccess,
  defaultTerminalProfileId,
}: {
  node: Node<TerminalNodeData>
  workspacePath: string
  agentFullAccess: boolean
  defaultTerminalProfileId?: string | null
}): Promise<Node<TerminalNodeData>> {
  const existingSessionId =
    typeof node.data.sessionId === 'string' ? node.data.sessionId.trim() : ''
  if (existingSessionId.length > 0) {
    try {
      await window.opencoveApi.pty.snapshot({ sessionId: existingSessionId })
      return node
    } catch {
      // fall through to runtime recovery
    }
  }

  if (node.data.kind === 'agent' && node.data.agent) {
    return hydrateAgentNode({
      node,
      workspacePath,
      agentFullAccess,
      defaultTerminalProfileId,
    })
  }

  if (node.data.kind !== 'terminal') {
    return node
  }

  try {
    const spawned = await window.opencoveApi.pty.spawn({
      cwd: resolveTerminalHydrationCwd(node, workspacePath),
      profileId: node.data.profileId ?? defaultTerminalProfileId ?? undefined,
      cols: 80,
      rows: 24,
    })

    return {
      ...node,
      data: {
        ...node.data,
        sessionId: spawned.sessionId,
        profileId: spawned.profileId,
        runtimeKind: spawned.runtimeKind,
        kind: 'terminal' as const,
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: node.data.scrollback,
        agent: null,
        task: null,
      },
    }
  } catch {
    return node
  }
}
