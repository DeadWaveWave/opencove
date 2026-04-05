import type {
  WorkspaceState,
  WorkspaceViewport,
} from '@contexts/workspace/presentation/renderer/types'
import { DEFAULT_WORKSPACE_VIEWPORT } from '@contexts/workspace/presentation/renderer/types'

export function sanitizeWorkspaceSpaces(
  spaces: WorkspaceState['spaces'],
): WorkspaceState['spaces'] {
  return spaces.map(space => ({
    ...space,
    nodeIds: [...new Set(space.nodeIds)],
  }))
}

export function createDefaultWorkspaceViewport(): WorkspaceViewport {
  return {
    x: DEFAULT_WORKSPACE_VIEWPORT.x,
    y: DEFAULT_WORKSPACE_VIEWPORT.y,
    zoom: DEFAULT_WORKSPACE_VIEWPORT.zoom,
  }
}
