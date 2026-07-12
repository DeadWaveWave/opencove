import type { LabelColor, NodeLabelColorOverride } from '@shared/types/labelColor'
import { normalizeProjectIconId, type ProjectIconId } from '@shared/types/projectIcon'
import {
  buildAgentNodeTitle,
  stripAgentProviderPrefix,
} from '@contexts/workspace/presentation/renderer/utils/agentTitle'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { ProjectContextMenuTarget } from '../types'
import { useAppStore } from '../store/useAppStore'

export function resolveTargetName(
  workspaces: WorkspaceState[],
  target: ProjectContextMenuTarget,
): string | null {
  const workspace = workspaces.find(candidate => candidate.id === target.workspaceId) ?? null
  if (!workspace) {
    return null
  }

  if (target.kind === 'project') {
    return workspace.name
  }

  if (target.kind === 'space') {
    return workspace.spaces.find(space => space.id === target.spaceId)?.name ?? null
  }

  const node = workspace.nodes.find(candidate => candidate.id === target.nodeId) ?? null
  if (!node || node.data.kind !== 'agent' || !node.data.agent) {
    return null
  }

  return stripAgentProviderPrefix(node.data.agent.provider, node.data.title)
}

export function resolveTargetSpacePath(
  workspaces: WorkspaceState[],
  target: ProjectContextMenuTarget,
): string | null {
  if (target.kind !== 'space') {
    return null
  }

  const workspace = workspaces.find(candidate => candidate.id === target.workspaceId) ?? null
  if (!workspace) {
    return null
  }

  const space = workspace.spaces.find(candidate => candidate.id === target.spaceId) ?? null
  if (!space) {
    return null
  }

  const trimmedSpacePath = space.directoryPath.trim()
  if (trimmedSpacePath.length > 0) {
    return trimmedSpacePath
  }

  const trimmedWorkspacePath = workspace.path.trim()
  return trimmedWorkspacePath.length > 0 ? trimmedWorkspacePath : null
}

export function renameTarget(target: ProjectContextMenuTarget, nextName: string): void {
  const normalizedName = nextName.trim()
  if (normalizedName.length === 0) {
    return
  }

  useAppStore.getState().setWorkspaces(previous =>
    previous.map(workspace => {
      if (workspace.id !== target.workspaceId) {
        return workspace
      }

      if (target.kind === 'project') {
        return workspace.name === normalizedName
          ? workspace
          : { ...workspace, name: normalizedName }
      }

      if (target.kind === 'space') {
        let changed = false
        const spaces = workspace.spaces.map(space => {
          if (space.id !== target.spaceId || space.name === normalizedName) {
            return space
          }
          changed = true
          return { ...space, name: normalizedName }
        })
        return changed ? { ...workspace, spaces } : workspace
      }

      let changed = false
      const nodes = workspace.nodes.map(node => {
        if (node.id !== target.nodeId || node.data.kind !== 'agent' || !node.data.agent) {
          return node
        }

        const title = buildAgentNodeTitle(node.data.agent.provider, normalizedName)
        if (node.data.title === title && node.data.titlePinnedByUser === true) {
          return node
        }

        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            title,
            titlePinnedByUser: true,
          },
        }
      })

      return changed ? { ...workspace, nodes } : workspace
    }),
  )
}

export function resolveTargetLabelColor(
  workspaces: WorkspaceState[],
  target: ProjectContextMenuTarget,
): LabelColor | NodeLabelColorOverride | null {
  const workspace = workspaces.find(candidate => candidate.id === target.workspaceId) ?? null
  if (!workspace || target.kind === 'project') {
    return null
  }

  if (target.kind === 'space') {
    return workspace.spaces.find(space => space.id === target.spaceId)?.labelColor ?? null
  }

  const node = workspace.nodes.find(candidate => candidate.id === target.nodeId) ?? null
  if (!node || node.data.kind !== 'agent') {
    return null
  }

  return node.data.labelColorOverride ?? null
}

export function resolveTargetSpacePinned(
  workspaces: WorkspaceState[],
  target: ProjectContextMenuTarget,
): boolean {
  if (target.kind !== 'space') {
    return false
  }

  const workspace = workspaces.find(candidate => candidate.id === target.workspaceId) ?? null
  return workspace?.spaces.find(space => space.id === target.spaceId)?.pinned === true
}

export function setTargetSpacePinned(target: ProjectContextMenuTarget, pinned: boolean): void {
  if (target.kind !== 'space') {
    return
  }

  useAppStore.getState().setWorkspaceSpacePinned(target.workspaceId, target.spaceId, pinned)
}

export function resolveTargetProjectIconId(
  workspaces: WorkspaceState[],
  target: ProjectContextMenuTarget,
): ProjectIconId | null {
  if (target.kind !== 'project') {
    return null
  }

  const workspace = workspaces.find(candidate => candidate.id === target.workspaceId) ?? null
  return normalizeProjectIconId(workspace?.iconId)
}

export function setTargetProjectIconId(
  target: ProjectContextMenuTarget,
  iconId: ProjectIconId | null,
): void {
  if (target.kind !== 'project') {
    return
  }

  useAppStore.getState().setProjectIconId(target.workspaceId, iconId)
}

export function setTargetLabelColor(
  target: ProjectContextMenuTarget,
  labelColor: LabelColor | NodeLabelColorOverride | null,
): void {
  if (target.kind === 'project') {
    return
  }

  useAppStore.getState().setWorkspaces(previous =>
    previous.map(workspace => {
      if (workspace.id !== target.workspaceId) {
        return workspace
      }

      if (target.kind === 'space') {
        const nextSpaceLabelColor = labelColor === 'none' ? null : labelColor
        let changed = false
        const spaces = workspace.spaces.map(space => {
          if (space.id !== target.spaceId || space.labelColor === nextSpaceLabelColor) {
            return space
          }

          changed = true
          return { ...space, labelColor: nextSpaceLabelColor }
        })

        return changed ? { ...workspace, spaces } : workspace
      }

      let changed = false
      const nodes = workspace.nodes.map(node => {
        if (node.id !== target.nodeId || node.data.kind !== 'agent') {
          return node
        }

        const previousColor = node.data.labelColorOverride ?? null
        if (previousColor === labelColor) {
          return node
        }

        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            labelColorOverride: labelColor,
          },
        }
      })

      return changed ? { ...workspace, nodes } : workspace
    }),
  )
}
