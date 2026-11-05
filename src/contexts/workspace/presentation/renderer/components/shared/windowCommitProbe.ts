import { useEffect } from 'react'
import type { WindowKindFamily } from '../../utils/windowKindFamily'

const counts: Partial<Record<WindowKindFamily, number>> = {}

/**
 * Test builds only (Tide phase 4.3): counts commits of every window header, by kind family. The
 * header is a leaf each window's own component renders, so a window that re-renders shows up here;
 * E2E asserts that zooming the canvas commits no window.
 */
export function useWindowCommitProbe(kind: WindowKindFamily): void {
  useEffect(() => {
    if (window.opencoveApi?.meta?.isTest === true) {
      counts[kind] = (counts[kind] ?? 0) + 1
    }
  })
}

export function readWindowCommitCounts(): Partial<Record<WindowKindFamily, number>> {
  return { ...counts }
}

export function resetWindowCommitCounts(): void {
  for (const kind of Object.keys(counts) as WindowKindFamily[]) {
    delete counts[kind]
  }
}
