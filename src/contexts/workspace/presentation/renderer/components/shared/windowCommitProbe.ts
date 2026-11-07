import { useEffect, useRef } from 'react'
import type { WindowKindFamily } from '../../utils/windowKindFamily'

const counts: Partial<Record<WindowKindFamily, number>> = {}
const countsByNode = new Map<string, number>()
const presentationCounts = new Map<string, number>()
type CommitInputs = Record<string, unknown>
const records: Array<{
  kind: string
  component: 'header' | 'node'
  nodeId: string | null
  at: number
  changes: Record<string, { before: unknown; after: unknown }>
  focused: boolean
  activeElement: string | null
}> = []
const identities = new WeakMap<object, number>()
let nextIdentity = 0

function describe(value: unknown): unknown {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    if (!identities.has(value)) {
      identities.set(value, ++nextIdentity)
    }
    return { identity: identities.get(value), type: typeof value }
  }
  return value ?? null
}

export function readWindowCommitRecords() {
  return [...records]
}

function changedInputs(previous: CommitInputs, current: CommitInputs) {
  return Object.fromEntries(
    [...new Set([...Object.keys(previous), ...Object.keys(current)])]
      .filter(key => !Object.is(previous[key], current[key]))
      .map(key => [key, { before: describe(previous[key]), after: describe(current[key]) }]),
  )
}

/** Distinguishes React Flow's selected/geometry/data props from a window's local state. */
export function useWindowNodeCommitProbe(inputs: { id: string; data: { kind?: string } }) {
  const previous = useRef<CommitInputs>({})
  useEffect(() => {
    if (window.opencoveApi?.meta?.isTest !== true) {
      return
    }
    const current = {
      ...inputs,
      ...Object.fromEntries(
        Object.entries(inputs.data).map(([key, value]) => [`data.${key}`, value]),
      ),
    }
    records.push({
      component: 'node',
      kind: inputs.data.kind ?? '',
      nodeId: inputs.id,
      at: performance.now(),
      changes: changedInputs(previous.current, current),
      focused: document.hasFocus(),
      activeElement: document.activeElement?.className ?? null,
    })
    previous.current = current
    if (records.length > 500) {
      records.shift()
    }
  })
}

/** Includes the compact shell even when a memoized runtime/header does not render. */
export function useWindowPresentationCommitProbe(nodeId: string): void {
  useEffect(() => {
    if (window.opencoveApi?.meta?.isTest === true) {
      presentationCounts.set(nodeId, (presentationCounts.get(nodeId) ?? 0) + 1)
    }
  })
}

export function readWindowPresentationCommitCounts(): Record<string, number> {
  return Object.fromEntries(presentationCounts)
}

/**
 * Test builds only (Tide phase 4.3): counts commits of every window header, by kind family. The
 * header is a leaf each window's own component renders, so a window that re-renders shows up here;
 * E2E asserts that zooming the canvas commits no window.
 */
export function useWindowCommitProbe(kind: WindowKindFamily, inputs: CommitInputs) {
  const element = useRef<HTMLElement>(null)
  const previous = useRef<CommitInputs>({})
  useEffect(() => {
    if (window.opencoveApi?.meta?.isTest === true) {
      counts[kind] = (counts[kind] ?? 0) + 1
      const node = element.current?.closest('.react-flow__node')
      const nodeId = node?.getAttribute('data-id')
      if (nodeId) {
        countsByNode.set(nodeId, (countsByNode.get(nodeId) ?? 0) + 1)
      }
      const current: CommitInputs = { ...inputs, selected: node?.classList.contains('selected') }
      const changes = changedInputs(previous.current, current)
      previous.current = current
      records.push({
        component: 'header',
        kind,
        nodeId: nodeId ?? null,
        at: performance.now(),
        changes,
        focused: document.hasFocus(),
        activeElement: document.activeElement?.className ?? null,
      })
      if (records.length > 500) {
        records.shift()
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
  records.length = 0
  countsByNode.clear()
  presentationCounts.clear()
  for (const kind of Object.keys(counts) as WindowKindFamily[]) {
    delete counts[kind]
  }
}
