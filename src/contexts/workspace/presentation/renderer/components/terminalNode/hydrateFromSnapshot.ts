import type { Terminal } from '@xterm/xterm'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './scrollback'
import type { CachedTerminalScreenState } from './screenStateCache'

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

async function writeTerminal(terminal: Terminal, data: string): Promise<void> {
  if (data.length === 0) {
    return
  }

  await new Promise<void>(resolve => {
    terminal.write(data, () => {
      resolve()
    })
  })
}

export async function hydrateTerminalFromSnapshot({
  attachPromise,
  sessionId,
  terminal,
  kind,
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

  if (placeholderPayload.length > 0) {
    await writeTerminal(terminal, placeholderPayload)
    onHydratedWriteCommitted(rawSnapshot)
  }

  try {
    await attachPromise.catch(() => undefined)

    if (kind === 'agent') {
      // Agent CLIs restore their own history after attach. Do not block hydration on snapshot
      // polling: delaying terminal replies can cause some CLIs to fall back to no-color mode, and
      // it can also surface echoed escape sequences (for example `^[[...` / `^[]...`) when replies
      // arrive after the CLI has exited raw/noecho mode.
      if (placeholderPayload.length === 0) {
        const snapshot = await takePtySnapshot({ sessionId })
        rawSnapshot = mergeScrollbackSnapshots(persistedSnapshot, snapshot.data)
        const delta = resolveScrollbackDelta(persistedSnapshot, rawSnapshot)
        await writeTerminal(terminal, delta)
      }
    } else {
      const snapshot = await takePtySnapshot({ sessionId })
      if (cachedSerializedScreen.length > 0) {
        const delta = resolveScrollbackDelta(baseRawSnapshot, snapshot.data)
        rawSnapshot = mergeScrollbackSnapshots(baseRawSnapshot, snapshot.data)

        if (!shouldSkipRawDeltaForSerializedScreen(cachedSerializedScreen, delta)) {
          await writeTerminal(terminal, delta)
        }
      } else {
        rawSnapshot = mergeScrollbackSnapshots(persistedSnapshot, snapshot.data)
        const delta = resolveScrollbackDelta(persistedSnapshot, rawSnapshot)
        await writeTerminal(terminal, delta)
      }
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
