import React from 'react'
import type { WorkspaceSpaceState } from '../../../types'

export function useActiveExplorerSpace(
  openExplorerSpaceId: string | null,
  spaces: WorkspaceSpaceState[],
): WorkspaceSpaceState | null {
  return React.useMemo(() => {
    if (!openExplorerSpaceId) {
      return null
    }

    return spaces.find(space => space.id === openExplorerSpaceId) ?? null
  }, [openExplorerSpaceId, spaces])
}
