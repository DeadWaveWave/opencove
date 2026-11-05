import { useEffect, useRef } from 'react'
import type { WindowKindFamily } from '../../utils/windowKindFamily'

const counts: Partial<Record<WindowKindFamily, number>> = {}
const countsByNode = new Map<string, number>()

/**
 * Test builds only (Tide phase 4.3): counts commits of every window header, by kind family. The
 * header is a leaf each window's own component renders, so a window that re-renders shows up here;
 * E2E asserts that zooming the canvas commits no window.
 */
export function useWindowCommitProbe(kind: WindowKindFamily) {
  const element = useRef<HTMLElement>(null)
  useEffect(() => {
    if (window.opencoveApi?.meta?.isTest === true) {
      counts[kind] = (counts[kind] ?? 0) + 1
      const nodeId = element.current?.closest('.react-flow__node')?.getAttribute('data-id')
      if (nodeId) {
        countsByNode.set(nodeId, (countsByNode.get(nodeId) ?? 0) + 1)
      }
    }
  })
  return element
}

export function readWindowCommitCountsByNode(): Record<string, number> {
  return Object.fromEntries(countsByNode)
}

export function readWindowCommitCounts(): Partial<Record<WindowKindFamily, number>> {
  return { ...counts }
}

export function resetWindowCommitCounts(): void {
  countsByNode.clear()
  for (const kind of Object.keys(counts) as WindowKindFamily[]) {
    delete counts[kind]
  }
}
