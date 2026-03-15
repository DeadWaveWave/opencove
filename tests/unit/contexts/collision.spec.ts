import { describe, expect, it } from 'vitest'
import {
  findNearestFreePosition,
  findNearestFreePositionOnRight,
  clampSizeToNonOverlapping,
  isPositionAvailable,
} from '../../../src/contexts/workspace/presentation/renderer/utils/collision'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

const baseNode = {
  type: 'terminalNode',
  data: {
    sessionId: 's1',
    title: 'terminal-1',
    width: 400,
    height: 280,
    kind: 'terminal',
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: null,
    note: null,
  } satisfies TerminalNodeData,
}

describe('collision utils', () => {
  it('finds non-overlapping position for new node', () => {
    const nodes = [
      {
        ...baseNode,
        id: 'n1',
        position: { x: 0, y: 0 },
      },
    ]

    const next = findNearestFreePosition({ x: 20, y: 20 }, { width: 400, height: 280 }, nodes)

    expect(next).not.toEqual({ x: 20, y: 20 })
  })

  it('keeps original position when no collision', () => {
    const nodes = [
      {
        ...baseNode,
        id: 'n1',
        position: { x: 0, y: 0 },
      },
    ]

    const next = findNearestFreePosition({ x: 600, y: 20 }, { width: 300, height: 200 }, nodes)

    expect(next).toEqual({ x: 600, y: 20 })
  })

  it('finds a free position on the right without falling back to the left side', () => {
    const nodes = [
      {
        ...baseNode,
        id: 'n1',
        position: { x: 456, y: 140 },
      },
      {
        ...baseNode,
        id: 'n2',
        position: { x: 456, y: 444 },
      },
    ]

    const next = findNearestFreePositionOnRight(
      { x: 456, y: 140 },
      { width: 400, height: 280 },
      nodes,
    )

    expect(next).not.toBeNull()
    expect(next?.x).toBeGreaterThanOrEqual(456)
  })

  it('clamps resize when desired size overlaps with other node', () => {
    const nodes = [
      {
        ...baseNode,
        id: 'n1',
        position: { x: 0, y: 0 },
      },
      {
        ...baseNode,
        id: 'n2',
        position: { x: 420, y: 0 },
      },
    ]

    const nextSize = clampSizeToNonOverlapping(
      { x: 0, y: 0 },
      { width: 500, height: 300 },
      { width: 320, height: 220 },
      nodes,
      'n1',
    )

    expect(nextSize.width).toBeLessThanOrEqual(420)
    expect(nextSize.height).toBeLessThanOrEqual(300)
    expect(nextSize.width).toBeGreaterThanOrEqual(320)
    expect(nextSize.height).toBeGreaterThanOrEqual(220)
  })

  it('returns false when position still overlaps', () => {
    const nodes = [
      {
        ...baseNode,
        id: 'n1',
        position: { x: 0, y: 0 },
      },
    ]

    const available = isPositionAvailable({ x: 10, y: 10 }, { width: 400, height: 280 }, nodes)

    expect(available).toBe(false)
  })

  it('returns true when position only touches the edge', () => {
    const nodes = [
      {
        ...baseNode,
        id: 'n1',
        position: { x: 0, y: 0 },
      },
    ]

    const available = isPositionAvailable({ x: 400, y: 0 }, { width: 300, height: 220 }, nodes)

    expect(available).toBe(true)
  })
})
