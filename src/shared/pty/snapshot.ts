const MAX_SNAPSHOT_CHARS = 400_000

export interface SnapshotState {
  chunks: string[]
  head: number
  length: number
}

export function createEmptySnapshotState(): SnapshotState {
  return { chunks: [], head: 0, length: 0 }
}

function trimSnapshot(state: SnapshotState): void {
  if (state.length <= MAX_SNAPSHOT_CHARS) {
    return
  }

  let excess = state.length - MAX_SNAPSHOT_CHARS

  while (excess > 0 && state.head < state.chunks.length) {
    const headChunk = state.chunks[state.head] ?? ''
    if (headChunk.length <= excess) {
      excess -= headChunk.length
      state.length -= headChunk.length
      state.head += 1
      continue
    }

    state.chunks[state.head] = headChunk.slice(excess)
    state.length -= excess
    excess = 0
  }

  if (state.head > 64) {
    state.chunks = state.chunks.slice(state.head)
    state.head = 0
  }
}

export function appendSnapshotData(state: SnapshotState, data: string): void {
  if (data.length === 0) {
    return
  }

  if (data.length >= MAX_SNAPSHOT_CHARS) {
    state.chunks = [data.slice(-MAX_SNAPSHOT_CHARS)]
    state.head = 0
    state.length = MAX_SNAPSHOT_CHARS
    return
  }

  state.chunks.push(data)
  state.length += data.length
  trimSnapshot(state)
}

export function snapshotToString(state: SnapshotState): string {
  if (state.length === 0 || state.head >= state.chunks.length) {
    return ''
  }

  return state.chunks.slice(state.head).join('')
}
