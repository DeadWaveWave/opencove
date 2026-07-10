import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { readTerminalRenderDimensionsSafely } from './renderServiceSafety'
import { canRefreshTerminalLayout } from './terminalGeometryLayout'
import type { PtySize } from './terminalGeometryTypes'

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

export async function resolveStableMeasuredTerminalNodeGeometry({
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

    const nextPtySize = proposed
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
