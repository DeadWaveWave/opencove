import React from 'react'
import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'

export function useActiveExplorerSpace(
  openExplorerSpaceId: string | null,
  spaces: WorkspaceSpaceState[],
  spaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null,
): WorkspaceSpaceState | null {
  return React.useMemo(() => {
    if (!openExplorerSpaceId) {
      return null
    }

    const space = spaces.find(candidate => candidate.id === openExplorerSpaceId)
    if (!space) {
      return null
    }
    // Match the frame's live projection, including descendant and pushed Spaces.
    // The preview is presentation only; drag finalization owns the durable rect.
    const rect = spaceFramePreview?.get(space.id)
    return rect && rect !== space.rect ? { ...space, rect } : space
  }, [openExplorerSpaceId, spaces, spaceFramePreview])
}
