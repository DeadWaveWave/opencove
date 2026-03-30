import type { Terminal } from '@xterm/xterm'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './scrollback'
import type { CachedTerminalScreenState } from './screenStateCache'

export async function hydrateTerminalFromSnapshot({
  attachPromise,
  sessionId,
  terminal,
  cachedScreenState,
  persistedSnapshot,
  takePtySnapshot,
  isDisposed,
  onHydratedWriteCommitted,
  finalizeHydration,
}: {
  attachPromise: Promise<void | undefined>
  sessionId: string
  terminal: Terminal
  cachedScreenState: CachedTerminalScreenState | null
  persistedSnapshot: string
  takePtySnapshot: (payload: { sessionId: string }) => Promise<{ data: string }>
  isDisposed: () => boolean
  onHydratedWriteCommitted: (rawSnapshot: string) => void
  finalizeHydration: (rawSnapshot: string) => void
}): Promise<void> {
  await attachPromise.catch(() => undefined)

  const cachedSerializedScreen = cachedScreenState?.serialized ?? ''
  const baseRawSnapshot =
    cachedScreenState && cachedScreenState.rawSnapshot.length > 0
      ? cachedScreenState.rawSnapshot
      : persistedSnapshot
  let restoredPayload =
    cachedSerializedScreen.length > 0 ? cachedSerializedScreen : persistedSnapshot
  let rawSnapshot = baseRawSnapshot

  try {
    const snapshot = await takePtySnapshot({ sessionId })
    if (cachedSerializedScreen.length > 0) {
      restoredPayload = `${cachedSerializedScreen}${resolveScrollbackDelta(baseRawSnapshot, snapshot.data)}`
      rawSnapshot = mergeScrollbackSnapshots(baseRawSnapshot, snapshot.data)
    } else {
      rawSnapshot = mergeScrollbackSnapshots(persistedSnapshot, snapshot.data)
      restoredPayload = rawSnapshot
    }
  } catch {
    rawSnapshot = baseRawSnapshot
  }

  if (isDisposed()) {
    return
  }

  if (restoredPayload.length > 0) {
    terminal.write(restoredPayload, () => {
      onHydratedWriteCommitted(rawSnapshot)
      finalizeHydration(rawSnapshot)
    })
    return
  }

  finalizeHydration(rawSnapshot)
}
