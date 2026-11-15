import type { CanvasSliceWrite } from './canvasStore'

export interface CanvasSelectionState {
  /** Document order, as written. */
  readonly nodeIds: readonly string[]
  /** De-duplicated and sorted with localeCompare. */
  readonly spaceIds: readonly string[]
}

export interface CanvasSelectionCommands {
  /** Spaces unchanged. */
  setNodeIds(nodeIds: readonly string[]): void
  /** Nodes unchanged. */
  setSpaceIds(spaceIds: readonly string[]): void
  select(next: { nodeIds: readonly string[]; spaceIds: readonly string[] }): void
  clear(): void
  /** Drops ids that are not in the sets; no-op when nothing is dropped. */
  retain(existing: { nodeIds: ReadonlySet<string>; spaceIds: ReadonlySet<string> }): void
}

const EMPTY: readonly string[] = []

export function createInitialCanvasSelectionState(): CanvasSelectionState {
  return { nodeIds: EMPTY, spaceIds: EMPTY }
}

function areEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function toSortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right))
}

/** The old list when equal, so an unchanged list keeps its reference. */
function keepIfEqual(current: readonly string[], next: readonly string[]): readonly string[] {
  return areEqual(current, next) ? current : next
}

export function createCanvasSelectionCommands(
  write: CanvasSliceWrite<CanvasSelectionState>,
): CanvasSelectionCommands {
  const apply = (
    state: CanvasSelectionState,
    nodeIds: readonly string[],
    spaceIds: readonly string[],
  ): CanvasSelectionState => {
    const nextNodeIds = keepIfEqual(state.nodeIds, nodeIds)
    const nextSpaceIds = keepIfEqual(state.spaceIds, spaceIds)
    return nextNodeIds === state.nodeIds && nextSpaceIds === state.spaceIds
      ? state
      : { nodeIds: nextNodeIds, spaceIds: nextSpaceIds }
  }

  return {
    setNodeIds: nodeIds => write(state => apply(state, [...nodeIds], state.spaceIds)),
    setSpaceIds: spaceIds => write(state => apply(state, state.nodeIds, toSortedUnique(spaceIds))),
    select: next => write(state => apply(state, [...next.nodeIds], toSortedUnique(next.spaceIds))),
    clear: () => write(state => apply(state, EMPTY, EMPTY)),
    retain: existing =>
      write(state =>
        apply(
          state,
          state.nodeIds.filter(id => existing.nodeIds.has(id)),
          state.spaceIds.filter(id => existing.spaceIds.has(id)),
        ),
      ),
  }
}
