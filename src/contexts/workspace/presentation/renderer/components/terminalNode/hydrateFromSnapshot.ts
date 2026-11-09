import type { Terminal } from '@xterm/xterm'
import type {
  AttachTerminalResult,
  PresentationSnapshotTerminalResult,
} from '@shared/contracts/dto'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './scrollback'
import type { CachedTerminalScreenState } from './screenStateCache'
import type { TerminalHydrationBaselineSource } from './useTerminalRuntimeSession.support'
import {
  captureTerminalScrollState,
  resizeTerminalPreservingScrollState,
  type TerminalScrollStateSnapshot,
} from './effectiveDevicePixelRatio'
import { stripTerminalQuerySequences } from '@shared/terminal/automaticTerminalSequences'
import { writeTerminalAsync } from './writeTerminal'
import { applyPresentationSnapshot } from './applyPresentationSnapshot'
import { containsMeaningfulTerminalDisplayContent } from './hydrationReplacement'
import {
  resetTerminalCwdObservation,
  suspendTerminalCwdObservation,
} from './links/terminalCwdObservation'

const ALT_BUFFER_ENTER_MARKER = '\u001b[?1049h'
const ALT_BUFFER_EXIT_MARKER = '\u001b[?1049l'
const PRESENTATION_SNAPSHOT_ATTACH_TIMEOUT_MS = 1_500

export type TerminalHydrationResult = 'complete' | 'retryable' | 'disposed'

async function writeHydrationSnapshotAsync(terminal: Terminal, data: string): Promise<void> {
  const suspendedCwdObservation = suspendTerminalCwdObservation(terminal)
  try {
    // Replayed history: its queries were answered when it first ran.
    await writeTerminalAsync(terminal, stripTerminalQuerySequences(data))
  } finally {
    suspendedCwdObservation.dispose()
  }
}

async function awaitAttachForPresentationSnapshot(
  attachPromise: Promise<AttachTerminalResult | undefined>,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null

  try {
    await Promise.race([
      attachPromise.catch(() => undefined),
      new Promise<void>(resolve => {
        timeout = setTimeout(resolve, PRESENTATION_SNAPSHOT_ATTACH_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout)
    }
  }
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

function leavesTerminalInAlternateBuffer(snapshot: string): boolean {
  return (
    snapshot.lastIndexOf(ALT_BUFFER_ENTER_MARKER) > snapshot.lastIndexOf(ALT_BUFFER_EXIT_MARKER)
  )
}

function captureActiveScreenText(terminal: Terminal): string {
  const buffer = terminal.buffer?.active
  if (!buffer) {
    return ''
  }

  const startLine = Math.max(0, buffer.viewportY)
  const lines: string[] = []
  for (let offset = 0; offset < terminal.rows; offset += 1) {
    const line = buffer.getLine(startLine + offset)
    lines.push(line?.translateToString(true) ?? '')
  }
  return lines.join('\r\n').trimEnd()
}

function createTerminalEpochTransition(options: {
  terminal: Terminal
  previousSnapshot: string
  alternateScreenPreview: string
}): string {
  const exitAlternateBuffer = leavesTerminalInAlternateBuffer(options.previousSnapshot)
    ? ALT_BUFFER_EXIT_MARKER
    : ''
  const archivedAlternateScreen =
    exitAlternateBuffer.length > 0 && options.alternateScreenPreview.length > 0
      ? `\r\n${options.alternateScreenPreview}`
      : ''
  const scrollPreviousViewportIntoHistory = '\r\n'.repeat(
    Math.max(1, Math.min(200, options.terminal.rows)),
  )
  return `${exitAlternateBuffer}${archivedAlternateScreen}${scrollPreviousViewportIntoHistory}`
}

function hasPresentationSnapshotState(
  snapshot: PresentationSnapshotTerminalResult | null,
): snapshot is PresentationSnapshotTerminalResult {
  // An authoritative blank screen still carries buffer and input-mode truth.
  // Restored-agent visibility is handled separately by the visible-output gate.
  return snapshot !== null && snapshot.serializedScreen.length > 0
}

function applyPresentationSnapshotGeometry(
  terminal: Terminal,
  snapshot: PresentationSnapshotTerminalResult | null,
): void {
  if (!snapshot) {
    return
  }

  const nextCols = Math.max(1, snapshot.cols)
  const nextRows = Math.max(1, snapshot.rows)
  if (terminal.cols !== nextCols || terminal.rows !== nextRows) {
    resizeTerminalPreservingScrollState(terminal, nextCols, nextRows)
  }
}

export async function hydrateTerminalFromSnapshot({
  attachPromise,
  sessionId,
  terminal,
  kind,
  useLivePtySnapshotDuringHydration = kind !== 'agent',
  runtimeEpochChanged = false,
  skipInitialPlaceholderWrite = false,
  cachedScreenState,
  persistedSnapshot,
  presentationSnapshotPromise,
  takePtySnapshot,
  scrollStateToRestore,
  isDisposed,
  onHydratedWriteCommitted,
  onHydrationBaselineResolved,
  onPresentationSnapshotAccepted,
  onPresentationSnapshotGeometryApplied,
  finalizeHydration,
}: {
  attachPromise: Promise<AttachTerminalResult | undefined>
  sessionId: string
  terminal: Terminal
  kind: 'terminal' | 'agent'
  useLivePtySnapshotDuringHydration?: boolean
  runtimeEpochChanged?: boolean
  skipInitialPlaceholderWrite?: boolean
  cachedScreenState: CachedTerminalScreenState | null
  persistedSnapshot: string
  presentationSnapshotPromise?: Promise<PresentationSnapshotTerminalResult | null>
  takePtySnapshot: (payload: { sessionId: string }) => Promise<{ data: string }>
  scrollStateToRestore?: TerminalScrollStateSnapshot | null
  isDisposed: () => boolean
  onHydratedWriteCommitted: (rawSnapshot: string) => void
  onHydrationBaselineResolved?: (source: TerminalHydrationBaselineSource) => void
  onPresentationSnapshotAccepted?: (snapshot: PresentationSnapshotTerminalResult) => void
  onPresentationSnapshotGeometryApplied?: () => void
  finalizeHydration: (
    rawSnapshot: string,
    options?: {
      baselineAppliedSeq?: number | null
      scrollStateToRestore?: TerminalScrollStateSnapshot | null
    },
  ) => void
}): Promise<TerminalHydrationResult> {
  const rendererPlaceholderSnapshot = kind === 'agent' ? '' : persistedSnapshot
  const cachedSerializedScreen = kind === 'agent' ? '' : (cachedScreenState?.serialized ?? '')
  const placeholderPayload =
    cachedSerializedScreen.length > 0 ? cachedSerializedScreen : rendererPlaceholderSnapshot

  let presentationSnapshot: PresentationSnapshotTerminalResult | null = null
  if (presentationSnapshotPromise) {
    try {
      presentationSnapshot = await presentationSnapshotPromise
    } catch {
      presentationSnapshot = null
    }
  }
  if (isDisposed()) {
    return 'disposed'
  }

  const baseRawSnapshot = rendererPlaceholderSnapshot
  let rawSnapshot = baseRawSnapshot
  let hydrationBaselineSource: TerminalHydrationBaselineSource =
    placeholderPayload.length > 0 ? 'placeholder_snapshot' : 'empty'
  let pendingScrollStateToRestore = scrollStateToRestore ?? null

  const presentationBaseline: { snapshot: PresentationSnapshotTerminalResult | null } = {
    snapshot: null,
  }
  const hasPresentationSnapshotPayload = hasPresentationSnapshotState(presentationSnapshot)
  if (hasPresentationSnapshotPayload && presentationSnapshot) {
    const applied = await applyPresentationSnapshot({
      terminal,
      sessionId,
      snapshot: presentationSnapshot,
      isDisposed,
      apply: async candidate => {
        applyPresentationSnapshotGeometry(terminal, candidate)
        onPresentationSnapshotGeometryApplied?.()
        terminal.reset()
        const shouldArchivePreviousTerminalEpoch =
          runtimeEpochChanged && kind === 'terminal' && rendererPlaceholderSnapshot.length > 0
        if (shouldArchivePreviousTerminalEpoch) {
          await writeHydrationSnapshotAsync(terminal, rendererPlaceholderSnapshot)
          const epochTransition = createTerminalEpochTransition({
            terminal,
            previousSnapshot: rendererPlaceholderSnapshot,
            alternateScreenPreview: captureActiveScreenText(terminal),
          })
          await writeHydrationSnapshotAsync(terminal, epochTransition)
          await writeHydrationSnapshotAsync(terminal, candidate.serializedScreen)
          return `${rendererPlaceholderSnapshot}${epochTransition}${candidate.serializedScreen}`
        }
        await writeHydrationSnapshotAsync(terminal, candidate.serializedScreen)
        return candidate.serializedScreen
      },
      onAccepted: (candidate, data) => {
        presentationBaseline.snapshot = candidate
        rawSnapshot = data
        hydrationBaselineSource = 'presentation_snapshot'
        onPresentationSnapshotAccepted?.(candidate)
        onHydratedWriteCommitted(data)
      },
    })
    // Stale snapshots never fall back to raw history or reveal an invalid baseline.
    if (!applied || isDisposed()) {
      return isDisposed() ? 'disposed' : 'retryable'
    }
    await awaitAttachForPresentationSnapshot(attachPromise)
  } else {
    onPresentationSnapshotGeometryApplied?.()
    if (!skipInitialPlaceholderWrite && placeholderPayload.length > 0) {
      await writeHydrationSnapshotAsync(terminal, placeholderPayload)
      onHydratedWriteCommitted(rawSnapshot)
    }
  }
  const restoreFromLivePtySnapshot = async (): Promise<string> => {
    await attachPromise.catch(() => undefined)
    const snapshot = await takePtySnapshot({ sessionId })
    if (
      kind === 'agent' &&
      rendererPlaceholderSnapshot.trim().length > 0 &&
      snapshot.data.length > 0 &&
      !containsMeaningfulTerminalDisplayContent(snapshot.data)
    ) {
      return rendererPlaceholderSnapshot
    }

    const mergedSnapshot = mergeScrollbackSnapshots(rendererPlaceholderSnapshot, snapshot.data)
    const liveDelta = resolveScrollbackDelta(rendererPlaceholderSnapshot, mergedSnapshot)
    if (
      kind === 'agent' &&
      rendererPlaceholderSnapshot.trim().length > 0 &&
      liveDelta.length > 0 &&
      !containsMeaningfulTerminalDisplayContent(liveDelta)
    ) {
      return rendererPlaceholderSnapshot
    }

    if (cachedSerializedScreen.length > 0) {
      const delta = liveDelta

      if (shouldSkipRawDeltaForSerializedScreen(cachedSerializedScreen, delta)) {
        return mergedSnapshot
      }

      if (pendingScrollStateToRestore === null) {
        const capturedScrollState = captureTerminalScrollState(terminal)
        pendingScrollStateToRestore =
          capturedScrollState.viewportY === null ? null : capturedScrollState
      }
      resetTerminalCwdObservation(terminal)
      terminal.reset()
      await writeHydrationSnapshotAsync(terminal, mergedSnapshot)
      return mergedSnapshot
    }

    const delta = liveDelta
    await writeHydrationSnapshotAsync(terminal, delta)
    return mergedSnapshot
  }

  try {
    if (!hasPresentationSnapshotPayload && !useLivePtySnapshotDuringHydration) {
      // Agent CLIs restore their own history after attach. Do not block hydration on snapshot
      // polling: delaying terminal replies can cause some CLIs to fall back to no-color mode, and
      // it can also surface echoed escape sequences (for example `^[[...` / `^[]...`) when replies
      // arrive after the CLI has exited raw/noecho mode.
      // Do not await attach here: the PTY may start emitting terminal feature probes immediately,
      // and buffering output while waiting for `attach()` can delay xterm replies enough for some
      // CLIs to disable color.
      void attachPromise.catch(() => undefined)
    } else if (!hasPresentationSnapshotPayload) {
      rawSnapshot = await restoreFromLivePtySnapshot()
      hydrationBaselineSource = 'live_pty_snapshot'
    }
  } catch {
    rawSnapshot = baseRawSnapshot
  }

  if (isDisposed()) {
    return 'disposed'
  }

  onHydrationBaselineResolved?.(hydrationBaselineSource)
  onHydratedWriteCommitted(rawSnapshot)
  const baselineAppliedSeq = presentationBaseline.snapshot?.appliedSeq ?? null
  const finalizeOptions =
    baselineAppliedSeq === null && pendingScrollStateToRestore === null
      ? undefined
      : {
          ...(baselineAppliedSeq === null ? {} : { baselineAppliedSeq }),
          ...(pendingScrollStateToRestore === null
            ? {}
            : { scrollStateToRestore: pendingScrollStateToRestore }),
        }
  if (finalizeOptions === undefined) {
    finalizeHydration(rawSnapshot)
    return 'complete'
  }

  finalizeHydration(rawSnapshot, finalizeOptions)
  return 'complete'
}
