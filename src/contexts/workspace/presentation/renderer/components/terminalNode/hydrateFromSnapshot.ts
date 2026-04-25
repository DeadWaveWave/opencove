import type { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult } from '@shared/contracts/dto'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './scrollback'
import type { CachedTerminalScreenState } from './screenStateCache'
import type { TerminalHydrationBaselineSource } from './useTerminalRuntimeSession.support'
import { writeTerminalAsync } from './writeTerminal'
import { containsMeaningfulTerminalDisplayContent } from './hydrationReplacement'

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

function shouldUsePresentationSnapshotAsVisibleBaseline(options: {
  kind: 'terminal' | 'agent'
  persistedSnapshot: string
  presentationSnapshot: PresentationSnapshotTerminalResult | null
}): options is {
  kind: 'terminal' | 'agent'
  persistedSnapshot: string
  presentationSnapshot: PresentationSnapshotTerminalResult
} {
  const serializedScreen = options.presentationSnapshot?.serializedScreen ?? ''
  if (serializedScreen.length === 0) {
    return false
  }

  if (
    options.kind === 'agent' &&
    options.persistedSnapshot.trim().length > 0 &&
    !containsMeaningfulTerminalDisplayContent(serializedScreen)
  ) {
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
  presentationSnapshotPromise,
  takePtySnapshot,
  isDisposed,
  onHydratedWriteCommitted,
  onHydrationBaselineResolved,
  onPresentationSnapshotAccepted,
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
  presentationSnapshotPromise?: Promise<PresentationSnapshotTerminalResult | null>
  takePtySnapshot: (payload: { sessionId: string }) => Promise<{ data: string }>
  isDisposed: () => boolean
  onHydratedWriteCommitted: (rawSnapshot: string) => void
  onHydrationBaselineResolved?: (source: TerminalHydrationBaselineSource) => void
  onPresentationSnapshotAccepted?: (snapshot: PresentationSnapshotTerminalResult) => void
  finalizeHydration: (rawSnapshot: string) => void
}): Promise<void> {
  const cachedSerializedScreen = cachedScreenState?.serialized ?? ''
  const placeholderPayload =
    cachedSerializedScreen.length > 0 ? cachedSerializedScreen : persistedSnapshot

  let presentationSnapshot: PresentationSnapshotTerminalResult | null = null
  if (presentationSnapshotPromise) {
    try {
      presentationSnapshot = await presentationSnapshotPromise
    } catch {
      presentationSnapshot = null
    }
  }

  const baseRawSnapshot = persistedSnapshot
  let rawSnapshot = baseRawSnapshot
  let hydrationBaselineSource: TerminalHydrationBaselineSource =
    placeholderPayload.length > 0 ? 'placeholder_snapshot' : 'empty'

  const visiblePresentationSnapshot = shouldUsePresentationSnapshotAsVisibleBaseline({
    kind,
    persistedSnapshot,
    presentationSnapshot,
  })
    ? presentationSnapshot
    : null

  if (visiblePresentationSnapshot) {
    const nextCols = Math.max(1, visiblePresentationSnapshot.cols)
    const nextRows = Math.max(1, visiblePresentationSnapshot.rows)
    if (terminal.cols !== nextCols || terminal.rows !== nextRows) {
      terminal.resize(nextCols, nextRows)
    }

    await writeTerminalAsync(terminal, visiblePresentationSnapshot.serializedScreen)
    onPresentationSnapshotAccepted?.(visiblePresentationSnapshot)
    rawSnapshot = visiblePresentationSnapshot.serializedScreen
    hydrationBaselineSource = 'presentation_snapshot'
    onHydratedWriteCommitted(rawSnapshot)
  } else if (!skipInitialPlaceholderWrite && placeholderPayload.length > 0) {
    await writeTerminalAsync(terminal, placeholderPayload)
    onHydratedWriteCommitted(rawSnapshot)
  }

  const restoreFromLivePtySnapshot = async (): Promise<string> => {
    await attachPromise.catch(() => undefined)
    const snapshot = await takePtySnapshot({ sessionId })
    if (
      kind === 'agent' &&
      persistedSnapshot.trim().length > 0 &&
      snapshot.data.length > 0 &&
      !containsMeaningfulTerminalDisplayContent(snapshot.data)
    ) {
      return persistedSnapshot
    }

    const mergedSnapshot = mergeScrollbackSnapshots(persistedSnapshot, snapshot.data)
    const liveDelta = resolveScrollbackDelta(persistedSnapshot, mergedSnapshot)
    if (
      kind === 'agent' &&
      persistedSnapshot.trim().length > 0 &&
      liveDelta.length > 0 &&
      !containsMeaningfulTerminalDisplayContent(liveDelta)
    ) {
      return persistedSnapshot
    }

    if (cachedSerializedScreen.length > 0) {
      const delta = liveDelta

      if (shouldSkipRawDeltaForSerializedScreen(cachedSerializedScreen, delta)) {
        return mergedSnapshot
      }

      terminal.reset()
      await writeTerminalAsync(terminal, mergedSnapshot)
      return mergedSnapshot
    }

    const delta = liveDelta
    await writeTerminalAsync(terminal, delta)
    return mergedSnapshot
  }

  try {
    if (presentationSnapshot?.serializedScreen.length) {
      void attachPromise.catch(() => undefined)
    } else if (!useLivePtySnapshotDuringHydration) {
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
      hydrationBaselineSource = 'live_pty_snapshot'
    }
  } catch {
    rawSnapshot = baseRawSnapshot
  }

  if (isDisposed()) {
    return
  }

  onHydrationBaselineResolved?.(hydrationBaselineSource)
  onHydratedWriteCommitted(rawSnapshot)
  finalizeHydration(rawSnapshot)
}
