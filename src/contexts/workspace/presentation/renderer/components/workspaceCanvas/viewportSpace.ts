import { useEffect } from 'react'
import { useStore } from '@xyflow/react'
import { create } from 'zustand'
import { resolveInnermostSpaceAtPoint } from '@contexts/space/application/spaceContainment'
import type { WorkspaceSpaceState } from '../../types'

type SpaceLike = Pick<WorkspaceSpaceState, 'id' | 'rect' | 'parentSpaceId'>

/** The innermost Space under the centre of the viewport, or null over open canvas. */
export function resolveViewportCenterSpaceId(
  transform: readonly [number, number, number],
  width: number,
  height: number,
  spaces: readonly SpaceLike[],
): string | null {
  const [x, y, zoom] = transform
  if (!(zoom > 0) || width <= 0 || height <= 0) {
    return null
  }
  const center = { x: (width / 2 - x) / zoom, y: (height / 2 - y) / zoom }
  return resolveInnermostSpaceAtPoint([...spaces], center)?.id ?? null
}

interface ViewportSpaceStore {
  /** Transient UI state: which Space each workspace's viewport is centred on. */
  spaceIdByWorkspace: Record<string, string | null>
  report: (workspaceId: string, spaceId: string | null) => void
}

export const useViewportSpaceStore = create<ViewportSpaceStore>(set => ({
  spaceIdByWorkspace: {},
  report: (workspaceId, spaceId) =>
    set(state =>
      state.spaceIdByWorkspace[workspaceId] === spaceId
        ? state
        : { spaceIdByWorkspace: { ...state.spaceIdByWorkspace, [workspaceId]: spaceId } },
    ),
}))

/** Publishes the viewport's Space; re-renders only when the centre crosses into another Space. */
export function ViewportSpaceReporter({
  workspaceId,
  spaces,
}: {
  workspaceId: string
  spaces: readonly SpaceLike[]
}): null {
  const spaceId = useStore(state =>
    resolveViewportCenterSpaceId(state.transform, state.width, state.height, spaces),
  )
  const report = useViewportSpaceStore(state => state.report)
  useEffect(() => {
    report(workspaceId, spaceId)
  }, [report, spaceId, workspaceId])
  return null
}
