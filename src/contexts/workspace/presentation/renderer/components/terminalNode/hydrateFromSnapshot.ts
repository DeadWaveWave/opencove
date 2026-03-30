import type { Terminal } from '@xterm/xterm'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './scrollback'
import type { CachedTerminalScreenState } from './screenStateCache'

const ALT_BUFFER_MARKER = '\u001b[?1049h'

function shouldSkipRawDeltaForSerializedScreen(serialized: string): boolean {
  // xterm serialize addon prefixes alternate buffer content with ESC[?1049h ESC[H. When a TUI is in
  // alternate buffer, replaying raw PTY deltas (which are capped/truncated) can clobber the screen
  // with prompt/redraw output that happened while the terminal was detached. Prefer restoring the
  // committed serialized screen and let live output update it going forward.
  return serialized.includes(ALT_BUFFER_MARKER)
}

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
      const delta = resolveScrollbackDelta(baseRawSnapshot, snapshot.data)
      restoredPayload = shouldSkipRawDeltaForSerializedScreen(cachedSerializedScreen)
        ? cachedSerializedScreen
        : `${cachedSerializedScreen}${delta}`
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
