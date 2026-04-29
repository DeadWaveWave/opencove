import { useEffect, useRef } from 'react'
import type { WorkspaceSpaceState } from '../../../types'

export function useWorkspaceCanvasFocusSpaceRequest({
  focusSpaceId,
  focusSequence,
  spaces,
  focusSpaceInViewport,
}: {
  focusSpaceId?: string | null
  focusSequence?: number
  spaces: WorkspaceSpaceState[]
  focusSpaceInViewport: (spaceId: string) => boolean
}): void {
  const focusedSpaceRequestKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!focusSpaceId) {
      return
    }

    const requestKey = `${focusSpaceId}:${focusSequence ?? 0}`
    if (focusedSpaceRequestKeyRef.current === requestKey) {
      return
    }

    if (focusSpaceInViewport(focusSpaceId)) {
      focusedSpaceRequestKeyRef.current = requestKey
    }
  }, [focusSequence, focusSpaceId, spaces, focusSpaceInViewport])
}
