import type { Terminal } from '@xterm/xterm'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './scrollback'
import type { CachedTerminalScreenState } from './screenStateCache'

const ALT_BUFFER_ENTER_MARKER = '\u001b[?1049h'
const ALT_BUFFER_EXIT_MARKER = '\u001b[?1049l'
const SNAPSHOT_FINGERPRINT_TAIL_CHARS = 128

type SnapshotFingerprint = { length: number; tail: string }

function fingerprintSnapshot(snapshot: string): SnapshotFingerprint {
  if (snapshot.length === 0) {
    return { length: 0, tail: '' }
  }

  return {
    length: snapshot.length,
    tail:
      snapshot.length <= SNAPSHOT_FINGERPRINT_TAIL_CHARS
        ? snapshot
        : snapshot.slice(-SNAPSHOT_FINGERPRINT_TAIL_CHARS),
  }
}

function areFingerprintsEqual(left: SnapshotFingerprint, right: SnapshotFingerprint): boolean {
  return left.length === right.length && left.tail === right.tail
}

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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
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
      const MAX_WAIT_MS = 12_000
      const POLL_INTERVAL_MS = 200
      const REQUIRED_STABLE_READS = 3

      const start = Date.now()
      let stableReads = 0
      let lastFingerprint: SnapshotFingerprint | null = null
      let lastSnapshot = ''

      while (!isDisposed() && Date.now() - start < MAX_WAIT_MS) {
        try {
          // eslint-disable-next-line no-await-in-loop -- intentional polling until snapshot stabilizes
          const snapshot = await takePtySnapshot({ sessionId })
          lastSnapshot = typeof snapshot?.data === 'string' ? snapshot.data : ''
        } catch {
          break
        }

        const fingerprint = fingerprintSnapshot(lastSnapshot)
        if (
          lastSnapshot.length > 0 &&
          lastFingerprint &&
          areFingerprintsEqual(lastFingerprint, fingerprint)
        ) {
          stableReads += 1
          if (stableReads >= REQUIRED_STABLE_READS) {
            break
          }
        } else {
          stableReads = 0
        }

        lastFingerprint = fingerprint
        // eslint-disable-next-line no-await-in-loop -- intentional polling delay
        await delay(POLL_INTERVAL_MS)
      }

      if (!isDisposed() && lastSnapshot.length > 0) {
        terminal.clear()
        await writeTerminal(terminal, lastSnapshot)
        rawSnapshot = lastSnapshot
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
