import { describe, expect, it } from 'vitest'
import { resolveWorkspaceSnap } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceSnap'

describe('workspace snap', () => {
  it('snaps to the dot grid when near a grid line', () => {
    const result = resolveWorkspaceSnap({
      movingRect: { x: 47, y: 73, width: 240, height: 160 },
      candidateRects: [],
      grid: 24,
      threshold: 8,
      enableGrid: true,
      enableObject: false,
    })

    expect(result).toEqual({ dx: 1, dy: -1, guides: [] })
  })

  it('prefers object alignment guides over an equally close grid snap', () => {
    const result = resolveWorkspaceSnap({
      movingRect: { x: 50, y: 100, width: 200, height: 120 },
      candidateRects: [{ x: 48, y: 40, width: 200, height: 120 }],
      grid: 24,
      threshold: 8,
      enableGrid: true,
      enableObject: true,
    })

    expect(result.dx).toBe(-2)
    expect(result.guides).toEqual([{ kind: 'v', x: 48, y1: 40, y2: 220 }])
  })

  it('returns both horizontal and vertical guides for center alignment', () => {
    const result = resolveWorkspaceSnap({
      movingRect: { x: 205, y: 214, width: 120, height: 80 },
      candidateRects: [{ x: 200, y: 210, width: 120, height: 80 }],
      grid: 24,
      threshold: 8,
      enableGrid: false,
      enableObject: true,
    })

    expect(result).toEqual({
      dx: -5,
      dy: -4,
      guides: [
        { kind: 'v', x: 200, y1: 210, y2: 294 },
        { kind: 'h', y: 210, x1: 200, x2: 325 },
      ],
    })
  })
})
