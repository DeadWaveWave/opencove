import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  resolveWindowKindFamily,
  type WindowKindFamily,
} from '@contexts/workspace/presentation/renderer/utils/windowKindFamily'
import {
  resolveWindowSignal,
  type WindowSignal,
} from '@contexts/workspace/presentation/renderer/utils/windowSignal'
import { resolveNeedsYouSinceMs } from './sidebarAgents'

export type SpaceMinimapStatus = WindowSignal

export interface SpaceMinimapWindow {
  nodeId: string
  title: string
  family: WindowKindFamily
  status: SpaceMinimapStatus | null
  /** Position and size as fractions of the Space frame, clamped to it. */
  left: number
  top: number
  width: number
  height: number
}

export interface SpaceMinimapModel {
  /** Width over height of the drawn frame, clamped so very wide or tall Spaces stay readable. */
  aspectRatio: number
  windows: SpaceMinimapWindow[]
  workingCount: number
  waitingCount: number
}

const MIN_ASPECT = 1.05
const MAX_ASPECT = 2.2
const FIT_PADDING = 40

type Rect = { x: number; y: number; width: number; height: number }

function nodeRect(node: Node<TerminalNodeData>): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? node.measured?.width ?? node.data.width,
    height: node.height ?? node.measured?.height ?? node.data.height,
  }
}

function collectSpaceIds(root: WorkspaceSpaceState, spaces: readonly WorkspaceSpaceState[]) {
  const ids = new Set([root.id])
  let grew = true
  while (grew) {
    grew = false
    for (const space of spaces) {
      if (space.parentSpaceId && ids.has(space.parentSpaceId) && !ids.has(space.id)) {
        ids.add(space.id)
        grew = true
      }
    }
  }
  return ids
}

function boundsOf(rects: Rect[]): Rect {
  const left = Math.min(...rects.map(rect => rect.x)) - FIT_PADDING
  const top = Math.min(...rects.map(rect => rect.y)) - FIT_PADDING
  const right = Math.max(...rects.map(rect => rect.x + rect.width)) + FIT_PADDING
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height)) + FIT_PADDING
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

const NO_ONE_NEEDS_YOU: ReadonlyMap<string, number> = new Map()

/**
 * Every window in a root Space and its child Spaces, placed in the Space's own frame. An Agent
 * whose turn you have not answered (`needsYou`, as in `buildSidebarAgentItems`) waits for you.
 */
export function buildSpaceMinimap(
  workspace: WorkspaceState,
  space: WorkspaceSpaceState,
  needsYou: ReadonlyMap<string, number> = NO_ONE_NEEDS_YOU,
): SpaceMinimapModel {
  const spaceIds = collectSpaceIds(space, workspace.spaces)
  const nodeIds = new Set(
    workspace.spaces.filter(item => spaceIds.has(item.id)).flatMap(item => item.nodeIds),
  )
  const nodes = workspace.nodes.filter(node => nodeIds.has(node.id))
  const rects = nodes.map(nodeRect)
  const frame =
    space.rect && space.rect.width > 0 && space.rect.height > 0
      ? space.rect
      : rects.length > 0
        ? boundsOf(rects)
        : null
  if (!frame) {
    return { aspectRatio: 1.6, windows: [], workingCount: 0, waitingCount: 0 }
  }

  const windows = nodes.map((node, index): SpaceMinimapWindow => {
    const rect = rects[index]
    const left = clamp01((rect.x - frame.x) / frame.width)
    const top = clamp01((rect.y - frame.y) / frame.height)
    return {
      nodeId: node.id,
      title: node.data.title,
      family: resolveWindowKindFamily(node.data),
      status:
        resolveNeedsYouSinceMs(workspace.id, node, needsYou) === undefined
          ? resolveWindowSignal(node.data)
          : 'waiting',
      left,
      top,
      width: clamp01((rect.x + rect.width - frame.x) / frame.width) - left,
      height: clamp01((rect.y + rect.height - frame.y) / frame.height) - top,
    }
  })

  return {
    aspectRatio: Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, frame.width / frame.height)),
    windows,
    workingCount: windows.filter(window => window.status === 'working').length,
    waitingCount: windows.filter(window => window.status === 'waiting').length,
  }
}
