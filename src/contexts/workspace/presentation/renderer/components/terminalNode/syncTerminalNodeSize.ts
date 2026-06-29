import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import { resizeTerminalPreservingScrollState } from './effectiveDevicePixelRatio'
import { readTerminalRenderDimensionsSafely } from './renderServiceSafety'
import { resolveDomRendererSafeMeasuredSize } from './terminalGeometryDomSafety'
import { logTerminalGeometryDiagnostics } from './terminalGeometryDiagnostics'
import { fitTerminalNodeToMeasuredSize } from './terminalGeometryFit'
import { canRefreshTerminalLayout, refreshTerminalNodeSize } from './terminalGeometryLayout'
import type {
  FitTerminalNodeOptions,
  InitialTerminalNodeGeometryCommitResult,
  PtySize,
} from './terminalGeometryTypes'

export { createTerminalDomTextOverhangGeometryCommitScheduler } from './terminalDomTextOverhangScheduler'
export { fitTerminalNodeToMeasuredSize } from './terminalGeometryFit'
export { refreshTerminalNodeSize } from './terminalGeometryLayout'
export type { InitialTerminalNodeGeometryCommitResult } from './terminalGeometryTypes'

type StableMeasuredGeometrySample = PtySize & {
  containerWidth: number
  containerHeight: number
  renderCellWidth: number | null
  renderCellHeight: number | null
  renderCanvasWidth: number | null
  renderCanvasHeight: number | null
}

const STABLE_MEASURED_GEOMETRY_MIN_SAMPLES = 4
const STABLE_MEASURED_GEOMETRY_MAX_ATTEMPTS = 8

function normalizeGeometryRevision(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function createResizePayload({
  sessionId,
  cols,
  rows,
  reason,
  geometryRevision,
}: {
  sessionId: string
  cols: number
  rows: number
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
}) {
  const revision = normalizeGeometryRevision(geometryRevision)
  return {
    sessionId,
    cols,
    rows,
    reason,
    ...(revision !== null ? { revision } : {}),
  }
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        resolve()
      })
      return
    }

    window.setTimeout(resolve, 0)
  })
}

function isSameStableMeasuredGeometrySample(
  previous: StableMeasuredGeometrySample | null,
  next: StableMeasuredGeometrySample,
): boolean {
  return (
    previous !== null &&
    previous.cols === next.cols &&
    previous.rows === next.rows &&
    previous.containerWidth === next.containerWidth &&
    previous.containerHeight === next.containerHeight &&
    previous.renderCellWidth === next.renderCellWidth &&
    previous.renderCellHeight === next.renderCellHeight &&
    previous.renderCanvasWidth === next.renderCanvasWidth &&
    previous.renderCanvasHeight === next.renderCanvasHeight
  )
}

function normalizeSampleNumber(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.round(value * 100) / 100
}

function createStableMeasuredGeometrySample({
  terminal,
  container,
  measured,
}: {
  terminal: Terminal
  container: HTMLElement
  measured: PtySize
}): StableMeasuredGeometrySample {
  const renderDimensions = readTerminalRenderDimensionsSafely(terminal)
  return {
    cols: measured.cols,
    rows: measured.rows,
    containerWidth: container.clientWidth,
    containerHeight: container.clientHeight,
    renderCellWidth: normalizeSampleNumber(renderDimensions?.css?.cell?.width),
    renderCellHeight: normalizeSampleNumber(renderDimensions?.css?.cell?.height),
    renderCanvasWidth: normalizeSampleNumber(renderDimensions?.css?.canvas?.width),
    renderCanvasHeight: normalizeSampleNumber(renderDimensions?.css?.canvas?.height),
  }
}

async function resolveStableMeasuredTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
}): Promise<PtySize | null> {
  const attemptResolve = async (
    attempt: number,
    previousSample: StableMeasuredGeometrySample | null,
    lastResolvedSize: PtySize | null,
    stableSamples: number,
  ): Promise<PtySize | null> => {
    if (attempt >= STABLE_MEASURED_GEOMETRY_MAX_ATTEMPTS) {
      return lastResolvedSize
    }

    await waitForAnimationFrame()

    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const container = containerRef.current
    if (
      !canRefreshTerminalLayout({ terminal, container, isPointerResizingRef }) ||
      !terminal ||
      !fitAddon ||
      !container
    ) {
      return attemptResolve(attempt + 1, previousSample, lastResolvedSize, stableSamples)
    }

    const proposed = fitAddon.proposeDimensions()
    if (!proposed) {
      return attemptResolve(attempt + 1, previousSample, lastResolvedSize, stableSamples)
    }

    const nextPtySize = resolveDomRendererSafeMeasuredSize({
      terminal,
      container,
      measured: proposed,
    })
    applyTerminalNodeGeometryLocally({
      terminalRef,
      containerRef,
      isPointerResizingRef,
      size: nextPtySize,
    })
    const nextSample = createStableMeasuredGeometrySample({
      terminal,
      container,
      measured: nextPtySize,
    })
    const nextStableSamples = isSameStableMeasuredGeometrySample(previousSample, nextSample)
      ? stableSamples + 1
      : 1
    const canCommitStableGeometry =
      nextStableSamples >= 2 && attempt + 1 >= STABLE_MEASURED_GEOMETRY_MIN_SAMPLES

    if (canCommitStableGeometry) {
      return nextPtySize
    }

    return attemptResolve(attempt + 1, nextSample, nextPtySize, nextStableSamples)
  }

  return attemptResolve(0, null, null, 0)
}

export function commitTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  geometryRevision,
  options,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
  options?: FitTerminalNodeOptions
}): void {
  const nextPtySize = fitTerminalNodeToMeasuredSize({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    options,
  })

  if (!nextPtySize) {
    if (options?.logWhenStable !== false) {
      logTerminalGeometryDiagnostics({
        event: 'geometry-commit-skipped',
        terminal: terminalRef.current,
        fitAddon: fitAddonRef.current,
        container: containerRef.current,
        sessionId,
        reason,
        lastCommittedPtySize: lastCommittedPtySizeRef.current,
        skippedReason: 'no-next-size',
      })
    }
    return
  }

  logTerminalGeometryDiagnostics({
    event: 'geometry-commit-resize',
    terminal: terminalRef.current,
    fitAddon: fitAddonRef.current,
    container: containerRef.current,
    sessionId,
    reason,
    lastCommittedPtySize: lastCommittedPtySizeRef.current,
    nextPtySize,
  })
  void window.opencoveApi.pty.resize(
    createResizePayload({
      sessionId,
      cols: nextPtySize.cols,
      rows: nextPtySize.rows,
      reason,
      geometryRevision,
    }),
  )
}

async function commitMeasuredTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  geometryRevision,
  nextPtySize,
  commitEvent,
  skippedEvent,
  unchangedEvent,
  shouldCommit,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
  nextPtySize: PtySize | null
  commitEvent: string
  skippedEvent: string
  unchangedEvent: string
  shouldCommit?: () => boolean
}): Promise<InitialTerminalNodeGeometryCommitResult | null> {
  if (!nextPtySize) {
    logTerminalGeometryDiagnostics({
      event: skippedEvent,
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      container: containerRef.current,
      sessionId,
      reason,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      skippedReason: 'no-next-size',
    })
    return null
  }

  if (shouldCommit && !shouldCommit()) {
    logTerminalGeometryDiagnostics({
      event: skippedEvent,
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      container: containerRef.current,
      sessionId,
      reason,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      nextPtySize,
      skippedReason: 'stale-session',
    })
    return null
  }

  applyTerminalNodeGeometryLocally({
    terminalRef,
    containerRef,
    isPointerResizingRef,
    size: nextPtySize,
  })

  const revision = normalizeGeometryRevision(geometryRevision)
  const alreadyCommitted =
    lastCommittedPtySizeRef.current?.cols === nextPtySize.cols &&
    lastCommittedPtySizeRef.current.rows === nextPtySize.rows

  if (alreadyCommitted && revision === null) {
    logTerminalGeometryDiagnostics({
      event: unchangedEvent,
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      container: containerRef.current,
      sessionId,
      reason,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      nextPtySize,
    })
    return { ...nextPtySize, changed: false }
  }

  await window.opencoveApi.pty.resize(
    createResizePayload({
      sessionId,
      cols: nextPtySize.cols,
      rows: nextPtySize.rows,
      reason,
      geometryRevision,
    }),
  )

  if (shouldCommit && !shouldCommit()) {
    logTerminalGeometryDiagnostics({
      event: skippedEvent,
      terminal: terminalRef.current,
      fitAddon: fitAddonRef.current,
      container: containerRef.current,
      sessionId,
      reason,
      lastCommittedPtySize: lastCommittedPtySizeRef.current,
      nextPtySize,
      skippedReason: 'stale-session-after-resize',
    })
    return null
  }

  lastCommittedPtySizeRef.current = nextPtySize
  logTerminalGeometryDiagnostics({
    event: alreadyCommitted ? unchangedEvent : commitEvent,
    terminal: terminalRef.current,
    fitAddon: fitAddonRef.current,
    container: containerRef.current,
    sessionId,
    reason,
    lastCommittedPtySize: lastCommittedPtySizeRef.current,
    nextPtySize,
  })
  return { ...nextPtySize, changed: !alreadyCommitted }
}

function applyTerminalNodeGeometryLocally({
  terminalRef,
  containerRef,
  isPointerResizingRef,
  size,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  size: PtySize
}): void {
  const terminal = terminalRef.current
  if (!terminal) {
    return
  }

  if (terminal.cols !== size.cols || terminal.rows !== size.rows) {
    resizeTerminalPreservingScrollState(terminal, size.cols, size.rows)
  }

  refreshTerminalNodeSize({ terminalRef, containerRef, isPointerResizingRef })
}

export async function commitSettledTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  geometryRevision,
  shouldCommit,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
  shouldCommit?: () => boolean
}): Promise<InitialTerminalNodeGeometryCommitResult | null> {
  const nextPtySize = await resolveStableMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
  })

  return await commitMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    sessionId,
    reason,
    geometryRevision,
    nextPtySize,
    commitEvent: 'geometry-settled-commit-resized',
    skippedEvent: 'geometry-settled-commit-skipped',
    unchangedEvent: 'geometry-settled-commit-unchanged',
    shouldCommit,
  })
}

export async function commitInitialTerminalNodeGeometry({
  terminalRef,
  fitAddonRef,
  containerRef,
  isPointerResizingRef,
  lastCommittedPtySizeRef,
  sessionId,
  reason,
  geometryRevision,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
  sessionId: string
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
}): Promise<InitialTerminalNodeGeometryCommitResult | null> {
  const nextPtySize = await resolveStableMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
  })

  return await commitMeasuredTerminalNodeGeometry({
    terminalRef,
    fitAddonRef,
    containerRef,
    isPointerResizingRef,
    lastCommittedPtySizeRef,
    sessionId,
    reason,
    geometryRevision,
    nextPtySize,
    commitEvent: 'geometry-initial-commit-resized',
    skippedEvent: 'geometry-initial-commit-skipped',
    unchangedEvent: 'geometry-initial-commit-unchanged',
  })
}
