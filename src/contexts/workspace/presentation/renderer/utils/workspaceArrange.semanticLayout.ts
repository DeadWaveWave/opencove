import type { Rect } from './workspaceArrange.flowPacking'
import { computeBoundingRect } from './workspaceArrange.flowPacking'
import {
  resolveBestDenseGridPacking,
  resolveDenseGridAutoPlacement,
  type GridItem,
} from './workspaceArrange.gridPacking'
import { resolveCanonicalNodeGridSpan } from './workspaceNodeSizing'
import type { WorkspaceArrangeSemanticGroup } from './workspaceArrange.semantic'

interface WorkspaceArrangeSemanticLanePartition {
  ideaGroups: WorkspaceArrangeSemanticGroup[]
  workGroups: WorkspaceArrangeSemanticGroup[]
  contentGroups: WorkspaceArrangeSemanticGroup[]
}

function isWorkspaceArrangePlanningGroup(group: WorkspaceArrangeSemanticGroup): boolean {
  return group.kind === 'taskAgentPair' || group.members[0]?.kind === 'task'
}

function isWorkspaceArrangeIdeaGroup(group: WorkspaceArrangeSemanticGroup): boolean {
  return group.kind === 'single' && group.members[0]?.kind === 'note'
}

function partitionWorkspaceArrangeSemanticLanes(
  groups: WorkspaceArrangeSemanticGroup[],
): WorkspaceArrangeSemanticLanePartition {
  const ideaGroups: WorkspaceArrangeSemanticGroup[] = []
  const workGroups: WorkspaceArrangeSemanticGroup[] = []
  const contentGroups: WorkspaceArrangeSemanticGroup[] = []

  for (const group of groups) {
    if (isWorkspaceArrangeIdeaGroup(group)) {
      ideaGroups.push(group)
      continue
    }

    if (isWorkspaceArrangePlanningGroup(group)) {
      workGroups.push(group)
      continue
    }

    contentGroups.push(group)
  }

  return { ideaGroups, workGroups, contentGroups }
}

function resolveSemanticGroupSize({
  group,
  gap,
}: {
  group: WorkspaceArrangeSemanticGroup
  gap: number
}): { width: number; height: number } {
  const [firstMember, secondMember] = group.members
  if (!firstMember) {
    return { width: 0, height: 0 }
  }

  if (group.kind !== 'taskAgentPair' || !secondMember) {
    return {
      width: firstMember.node.data.width,
      height: firstMember.node.data.height,
    }
  }

  return {
    width: firstMember.node.data.width + gap + secondMember.node.data.width,
    height: Math.max(firstMember.node.data.height, secondMember.node.data.height),
  }
}

export function createWorkspaceArrangeSemanticFlowItems({
  groups,
  gap,
}: {
  groups: WorkspaceArrangeSemanticGroup[]
  gap: number
}): Array<{ id: string; width: number; height: number }> {
  return groups.map(group => ({
    id: group.key,
    ...resolveSemanticGroupSize({ group, gap }),
  }))
}

export function createWorkspaceArrangeSemanticGridItems(
  groups: WorkspaceArrangeSemanticGroup[],
): GridItem[] {
  return groups.map(group => {
    const [firstMember, secondMember] = group.members
    const firstSpan = resolveCanonicalNodeGridSpan(firstMember?.kind ?? 'terminal')

    if (group.kind !== 'taskAgentPair' || !secondMember) {
      return {
        id: group.key,
        colSpan: firstSpan.colSpan,
        rowSpan: firstSpan.rowSpan,
      }
    }

    const secondSpan = resolveCanonicalNodeGridSpan(secondMember.kind)
    return {
      id: group.key,
      colSpan: firstSpan.colSpan + secondSpan.colSpan,
      rowSpan: Math.max(firstSpan.rowSpan, secondSpan.rowSpan),
    }
  })
}

export function resolveWorkspaceArrangeSemanticGridPlacements({
  groups,
  start,
  cell,
  gap = 0,
  targetAspect,
  maxColumns,
  maxHeight,
  compactAreaTolerance,
}: {
  groups: WorkspaceArrangeSemanticGroup[]
  start: { x: number; y: number }
  cell: { width: number; height: number }
  gap?: number
  targetAspect: number
  maxColumns?: number
  maxHeight?: number
  compactAreaTolerance?: number
}): { placements: Map<string, { x: number; y: number }>; bounding: Rect } | null {
  if (groups.length === 0) {
    return {
      placements: new Map(),
      bounding: { x: start.x, y: start.y, width: 0, height: 0 },
    }
  }

  const { ideaGroups, workGroups, contentGroups } = partitionWorkspaceArrangeSemanticLanes(groups)
  if ((ideaGroups.length === 0 && workGroups.length === 0) || contentGroups.length === 0) {
    return resolveBestDenseGridPacking({
      items: createWorkspaceArrangeSemanticGridItems(groups),
      start,
      cell,
      gap,
      targetAspect,
      maxColumns,
      ...(typeof maxHeight === 'number' ? { maxHeight } : {}),
      ...(typeof compactAreaTolerance === 'number' ? { compactAreaTolerance } : {}),
    })
  }

  const strideX = cell.width + gap
  const strideY = cell.height + gap
  const allItems = createWorkspaceArrangeSemanticGridItems(groups)
  const itemById = new Map(allItems.map(item => [item.id, item]))
  const ideaItems = createWorkspaceArrangeSemanticGridItems(ideaGroups)
  const workItems = createWorkspaceArrangeSemanticGridItems(workGroups)
  const contentItems = createWorkspaceArrangeSemanticGridItems(contentGroups)
  const singleIdeaColumnWidth =
    ideaItems.length > 0 ? Math.max(...ideaItems.map(item => item.colSpan)) : 0
  const preferredIdeaColumnWidth =
    ideaItems.length > 1 ? singleIdeaColumnWidth * 2 : singleIdeaColumnWidth
  const workLaneWidth = workItems.length > 0 ? Math.max(...workItems.map(item => item.colSpan)) : 0
  const maxContentWidth =
    contentItems.length > 0 ? Math.max(...contentItems.map(item => item.colSpan)) : 0
  const minFallbackColumns = Math.max(1, singleIdeaColumnWidth + workLaneWidth + maxContentWidth)
  const safeMaxColumns = (() => {
    if (typeof maxColumns === 'number' && Number.isFinite(maxColumns)) {
      return Math.max(1, Math.floor(maxColumns))
    }

    const totalColSpan = allItems.reduce((sum, item) => sum + Math.max(1, item.colSpan), 0)
    return Math.max(minFallbackColumns, totalColSpan)
  })()
  const canUseTwoColumnIdeas =
    preferredIdeaColumnWidth > singleIdeaColumnWidth &&
    (!workItems.length || preferredIdeaColumnWidth + workLaneWidth <= safeMaxColumns)
  const ideaLaneColumnWidth = canUseTwoColumnIdeas
    ? preferredIdeaColumnWidth
    : singleIdeaColumnWidth
  const executionLaneStartCol = ideaLaneColumnWidth + workLaneWidth

  if (ideaLaneColumnWidth + workLaneWidth > safeMaxColumns) {
    return resolveBestDenseGridPacking({
      items: allItems,
      start,
      cell,
      gap,
      targetAspect,
      maxColumns: safeMaxColumns,
      ...(typeof maxHeight === 'number' ? { maxHeight } : {}),
      ...(typeof compactAreaTolerance === 'number' ? { compactAreaTolerance } : {}),
    })
  }

  const placements = new Map<string, { x: number; y: number }>()
  const placedRects: Rect[] = []

  const addPlacedItem = ({ id, col, row }: { id: string; col: number; row: number }) => {
    const item = itemById.get(id)
    if (!item) {
      return
    }

    const rect: Rect = {
      x: start.x + col * strideX,
      y: start.y + row * strideY,
      width: item.colSpan * cell.width + Math.max(0, item.colSpan - 1) * gap,
      height: item.rowSpan * cell.height + Math.max(0, item.rowSpan - 1) * gap,
    }

    placements.set(id, { x: rect.x, y: rect.y })
    placedRects.push(rect)
  }

  const placeVerticalLane = ({
    items,
    startCol,
  }: {
    items: GridItem[]
    startCol: number
  }): { rowsUsed: number } => {
    let rowCursor = 0

    for (const item of items) {
      addPlacedItem({ id: item.id, col: startCol, row: rowCursor })
      rowCursor += item.rowSpan
    }

    return { rowsUsed: rowCursor }
  }

  const placeIdeaLane = (): { rowsUsed: number; columnsUsed: number } => {
    if (ideaItems.length === 0 || ideaLaneColumnWidth <= 0) {
      return { rowsUsed: 0, columnsUsed: 0 }
    }

    const ideaGrid = resolveDenseGridAutoPlacement({
      items: ideaItems,
      columnCount: ideaLaneColumnWidth,
    })

    for (const [id, placement] of ideaGrid.placements.entries()) {
      addPlacedItem({ id, col: placement.col, row: placement.row })
    }

    return {
      rowsUsed: ideaGrid.rowsUsed,
      columnsUsed: ideaGrid.columnsUsed,
    }
  }

  const ideaLane = placeIdeaLane()
  const workLane = placeVerticalLane({ items: workItems, startCol: ideaLane.columnsUsed })
  const anchorRowsUsed = Math.max(ideaLane.rowsUsed, workLane.rowsUsed)
  const minContentColumns =
    contentItems.length > 0 ? Math.max(...contentItems.map(item => item.colSpan)) : 0
  const rightAvailableColumns = safeMaxColumns - executionLaneStartCol

  const appendPackedPlacements = (packedPlacements: Map<string, { x: number; y: number }>) => {
    for (const [id, placement] of packedPlacements.entries()) {
      const item = itemById.get(id)
      if (!item) {
        continue
      }

      placements.set(id, placement)
      placedRects.push({
        x: placement.x,
        y: placement.y,
        width: item.colSpan * cell.width + Math.max(0, item.colSpan - 1) * gap,
        height: item.rowSpan * cell.height + Math.max(0, item.rowSpan - 1) * gap,
      })
    }
  }

  let contentPlaced = false
  if (rightAvailableColumns >= minContentColumns) {
    const rightPacked = resolveBestDenseGridPacking({
      items: contentItems,
      start: {
        x: start.x + executionLaneStartCol * strideX,
        y: start.y,
      },
      cell,
      gap,
      targetAspect,
      maxColumns: rightAvailableColumns,
      ...(typeof maxHeight === 'number' ? { maxHeight } : {}),
      ...(typeof compactAreaTolerance === 'number' ? { compactAreaTolerance } : {}),
    })
    if (rightPacked) {
      appendPackedPlacements(rightPacked.placements)
      contentPlaced = true
    }
  }

  if (!contentPlaced) {
    const fallbackStart = {
      x: start.x,
      y: start.y + anchorRowsUsed * strideY,
    }
    const fallbackMaxHeight =
      typeof maxHeight === 'number'
        ? Math.max(0, maxHeight - (fallbackStart.y - start.y))
        : undefined
    const belowPacked = resolveBestDenseGridPacking({
      items: contentItems,
      start: fallbackStart,
      cell,
      gap,
      targetAspect,
      maxColumns: safeMaxColumns,
      ...(typeof fallbackMaxHeight === 'number' ? { maxHeight: fallbackMaxHeight } : {}),
      ...(typeof compactAreaTolerance === 'number' ? { compactAreaTolerance } : {}),
    })

    if (!belowPacked) {
      return null
    }

    appendPackedPlacements(belowPacked.placements)
  }

  const bounding = computeBoundingRect(placedRects) ?? {
    x: start.x,
    y: start.y,
    width: 0,
    height: 0,
  }

  return {
    placements,
    bounding,
  }
}

export function resolveWorkspaceArrangeSemanticNodePlacements({
  groups,
  groupPlacements,
  gap,
}: {
  groups: WorkspaceArrangeSemanticGroup[]
  groupPlacements: Map<string, { x: number; y: number }>
  gap: number
}): Map<string, { x: number; y: number }> {
  const placements = new Map<string, { x: number; y: number }>()

  for (const group of groups) {
    const groupPlacement = groupPlacements.get(group.key)
    if (!groupPlacement) {
      continue
    }

    const [firstMember, secondMember] = group.members
    if (!firstMember) {
      continue
    }

    placements.set(firstMember.node.id, {
      x: groupPlacement.x,
      y: groupPlacement.y,
    })

    if (group.kind !== 'taskAgentPair' || !secondMember) {
      continue
    }

    placements.set(secondMember.node.id, {
      x: groupPlacement.x + firstMember.node.data.width + gap,
      y: groupPlacement.y,
    })
  }

  return placements
}
