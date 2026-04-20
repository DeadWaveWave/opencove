import { useCallback, useEffect, type RefObject } from 'react'

/**
 * Snap the React Flow viewport and node CSS translate values to a DPR-aligned
 * grid so that GPU compositing layers land on integer device pixel boundaries.
 *
 * Uses an imperative snap function called only on initial render and onMoveEnd
 * — avoiding interference with React Flow's drag interactions.
 */
export function useViewportDprSnapping(containerRef: RefObject<HTMLElement | null>): {
  snapViewport: () => void
} {
  const snapViewport = useCallback(() => {
    const container = containerRef.current
    if (!container || typeof window === 'undefined') {
      return
    }

    const dpr = window.devicePixelRatio
    if (Math.abs(dpr - Math.round(dpr)) < 0.001) {
      return
    }

    const step = 1 / dpr

    const viewport = container.querySelector('.react-flow__viewport')
    if (viewport instanceof HTMLElement) {
      snapTranslate(viewport, step)
    }

    const nodes = container.querySelectorAll('.react-flow__node')
    nodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        snapTranslate(node, step)
      }
    })
  }, [containerRef])

  useEffect(() => {
    snapViewport()
  }, [snapViewport])

  return { snapViewport }
}

function snapTranslate(element: HTMLElement, step: number): void {
  const transform = element.style.transform
  if (!transform || transform === 'none') {
    return
  }

  const matrixMatch = transform.match(
    /^matrix\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/,
  )
  if (matrixMatch) {
    const tx = parseFloat(matrixMatch[5])
    const ty = parseFloat(matrixMatch[6])
    const snappedTx = snapToGrid(tx, step)
    const snappedTy = snapToGrid(ty, step)

    if (Math.abs(snappedTx - tx) < 0.001 && Math.abs(snappedTy - ty) < 0.001) {
      return
    }

    element.style.transform = `matrix(${matrixMatch[1]}, ${matrixMatch[2]}, ${matrixMatch[3]}, ${matrixMatch[4]}, ${snappedTx}, ${snappedTy})`
    return
  }

  const translateMatch = transform.match(
    /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/,
  )
  if (translateMatch) {
    const tx = parseFloat(translateMatch[1])
    const ty = parseFloat(translateMatch[2])
    const snappedTx = snapToGrid(tx, step)
    const snappedTy = snapToGrid(ty, step)

    if (Math.abs(snappedTx - tx) < 0.001 && Math.abs(snappedTy - ty) < 0.001) {
      return
    }

    element.style.transform = transform
      .replace(translateMatch[1], String(snappedTx))
      .replace(translateMatch[2], String(snappedTy))
  }
}

function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step
}