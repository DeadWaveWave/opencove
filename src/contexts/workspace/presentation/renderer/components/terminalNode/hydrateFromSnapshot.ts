import type { Terminal } from '@xterm/xterm'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './scrollback'
import type { CachedTerminalScreenState } from './screenStateCache'
import { writeTerminalAsync } from './writeTerminal'

const ALT_BUFFER_ENTER_MARKER = '\u001b[?1049h'
const ALT_BUFFER_EXIT_MARKER = '\u001b[?1049l'

function shouldSkipRawDeltaForSerializedScreen(serialized: string, delta: string): boolean {
  // xterm serialize addon prefixes alternate buffer content with ESC[?1049h ESC[H. When a TUI is in
  // alternate buffer, replaying raw PTY deltas (which are capped/truncated) can clobber the screen
  // with prompt/redraw output that happened while the terminal was detached. Prefer restoring the
  // committed serialized screen and let live output update it going forward.
  if (!serialized.includes(ALT_BUFFER_ENTER_MARKER)) {
    return false
  }

  // If the process exited the alternate buffer while detached, we must replay the delta so that
  // application cursor/raw-mode exits (and the shell prompt) restore correctly.
  if (delta.includes(ALT_BUFFER_EXIT_MARKER)) {
    return false
  }

  return true
}

export async function hydrateTerminalFromSnapshot({
  attachPromise,
  sessionId,
  terminal,
  kind,
  useLivePtySnapshotDuringHydration = kind !== 'agent',
  skipInitialPlaceholderWrite = false,
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
  kind: 'terminal' | 'agent'
  useLivePtySnapshotDuringHydration?: boolean
  skipInitialPlaceholderWrite?: boolean
  cachedScreenState: CachedTerminalScreenState | null
  persistedSnapshot: string
  takePtySnapshot: (payload: { sessionId: string }) => Promise<{ data: string }>
  isDisposed: () => boolean
  onHydratedWriteCommitted: (rawSnapshot: string) => void
  finalizeHydration: (rawSnapshot: string) => void
}): Promise<void> {
  const cachedSerializedScreen = cachedScreenState?.serialized ?? ''
  const baseRawSnapshot =
    cachedScreenState && cachedScreenState.rawSnapshot.length > 0
      ? cachedScreenState.rawSnapshot
      : persistedSnapshot
  const placeholderPayload =
    cachedSerializedScreen.length > 0 ? cachedSerializedScreen : persistedSnapshot
  let rawSnapshot = baseRawSnapshot

  if (!skipInitialPlaceholderWrite && placeholderPayload.length > 0) {
    await writeTerminalAsync(terminal, placeholderPayload)
    onHydratedWriteCommitted(rawSnapshot)
  }

  const restoreFromLivePtySnapshot = async (): Promise<string> => {
    await attachPromise.catch(() => undefined)
    const snapshot = await takePtySnapshot({ sessionId })

    if (cachedSerializedScreen.length > 0) {
      const delta = resolveScrollbackDelta(baseRawSnapshot, snapshot.data)
      const mergedSnapshot = mergeScrollbackSnapshots(baseRawSnapshot, snapshot.data)

      if (!shouldSkipRawDeltaForSerializedScreen(cachedSerializedScreen, delta)) {
        await writeTerminalAsync(terminal, delta)
      }

      return mergedSnapshot
    }

    const mergedSnapshot = mergeScrollbackSnapshots(persistedSnapshot, snapshot.data)
    const delta = resolveScrollbackDelta(persistedSnapshot, mergedSnapshot)
    await writeTerminalAsync(terminal, delta)
    return mergedSnapshot
  }

  try {
    if (!useLivePtySnapshotDuringHydration) {
      // Agent CLIs restore their own history after attach. Do not block hydration on snapshot
      // polling: delaying terminal replies can cause some CLIs to fall back to no-color mode, and
      // it can also surface echoed escape sequences (for example `^[[...` / `^[]...`) when replies
      // arrive after the CLI has exited raw/noecho mode.
      // Do not await attach here: the PTY may start emitting terminal feature probes immediately,
      // and buffering output while waiting for `attach()` can delay xterm replies enough for some
      // CLIs to disable color.
      void attachPromise.catch(() => undefined)
    } else {
      rawSnapshot = await restoreFromLivePtySnapshot()
    }
  } catch {
    rawSnapshot = baseRawSnapshot
  }

  if (isDisposed()) {
    return
  }

  onHydratedWriteCommitted(rawSnapshot)
  finalizeHydration(rawSnapshot)
}
