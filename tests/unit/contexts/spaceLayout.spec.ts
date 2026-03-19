import { describe, it, expect } from 'vitest'
import {
  computeSpaceRectFromNodes,
  getSpaceFrameHandleCursor,
  pushAwayLayout,
  resolveInteractiveSpaceFrameHandle,
  resolveSpaceFrameHandle,
} from '../../../src/contexts/workspace/presentation/renderer/utils/spaceLayout'

describe('spaceLayout', () => {
  it('computes an explicit space rect from owned nodes (padding + min size)', () => {
    expect(
      computeSpaceRectFromNodes([
        { x: 100, y: 200, width: 50, height: 60 },
        { x: 200, y: 100, width: 100, height: 100 },
      ]),
    ).toEqual({
      x: 76,
      y: 76,
      width: 248,
      height: 208,
    })
  })

  it('resolves corner/edge resize vs move handle based on hit zones', () => {
    const rect = { x: 0, y: 0, width: 200, height: 120 }

    expect(resolveSpaceFrameHandle({ rect, point: { x: 2, y: 2 }, zoom: 1 })).toEqual({
      kind: 'resize',
      edges: { left: true, top: true },
    })

    expect(resolveSpaceFrameHandle({ rect, point: { x: 100, y: 0 }, zoom: 1 })).toEqual({
      kind: 'move',
    })

    expect(resolveSpaceFrameHandle({ rect, point: { x: 100, y: 60 }, zoom: 1 })).toEqual({
      kind: 'move',
    })

    expect(resolveSpaceFrameHandle({ rect, point: { x: 30, y: 0 }, zoom: 1 })).toEqual({
      kind: 'move',
    })

    expect(resolveSpaceFrameHandle({ rect, point: { x: 200, y: 60 }, zoom: 1 })).toEqual({
      kind: 'resize',
      edges: { right: true },
    })
  })

  it('scales corner hitboxes with zoom (fixed screen px)', () => {
    const rect = { x: 0, y: 0, width: 200, height: 120 }

    expect(resolveSpaceFrameHandle({ rect, point: { x: 10, y: 10 }, zoom: 2 })).toEqual({
      kind: 'move',
    })

    expect(resolveSpaceFrameHandle({ rect, point: { x: 8, y: 8 }, zoom: 2 })).toEqual({
      kind: 'resize',
      edges: { left: true, top: true },
    })
  })

  it('converts single-edge region hits back to move and preserves corner resize', () => {
    const rect = { x: 0, y: 0, width: 200, height: 120 }

    expect(
      resolveInteractiveSpaceFrameHandle({
        rect,
        point: { x: 100, y: 0 },
        zoom: 1,
        mode: 'region',
      }),
    ).toEqual({ kind: 'move' })

    expect(
      resolveInteractiveSpaceFrameHandle({
        rect,
        point: { x: 2, y: 2 },
        zoom: 1,
        mode: 'region',
      }),
    ).toEqual({
      kind: 'resize',
      edges: { left: true, top: true },
    })
  })

  it('maps resize handles to the same directional cursors used by nodes', () => {
    expect(getSpaceFrameHandleCursor({ kind: 'move' })).toBe('grab')
    expect(getSpaceFrameHandleCursor({ kind: 'resize', edges: { right: true } })).toBe('ew-resize')
    expect(getSpaceFrameHandleCursor({ kind: 'resize', edges: { bottom: true } })).toBe('ns-resize')
    expect(getSpaceFrameHandleCursor({ kind: 'resize', edges: { left: true, top: true } })).toBe(
      'nwse-resize',
    )
    expect(getSpaceFrameHandleCursor({ kind: 'resize', edges: { right: true, top: true } })).toBe(
      'nesw-resize',
    )
  })

  it('pushes colliding groups away along the requested axis (with chain reactions)', () => {
    const gap = 24

    const next = pushAwayLayout({
      items: [
        {
          id: 'space-a',
          kind: 'space',
          groupId: 'space-a',
          rect: { x: 0, y: 0, width: 100, height: 100 },
        },
        {
          id: 'space-a-node',
          kind: 'node',
          groupId: 'space-a',
          rect: { x: 10, y: 10, width: 20, height: 20 },
        },
        {
          id: 'root-1',
          kind: 'node',
          groupId: 'root-1',
          rect: { x: 80, y: 10, width: 20, height: 20 },
        },
        {
          id: 'root-2',
          kind: 'node',
          groupId: 'root-2',
          rect: { x: 130, y: 10, width: 20, height: 20 },
        },
      ],
      pinnedGroupIds: ['space-a'],
      sourceGroupIds: ['space-a'],
      directions: ['x+'],
      gap,
    })

    const root1 = next.find(item => item.id === 'root-1')
    const root2 = next.find(item => item.id === 'root-2')
    expect(root1?.rect.x).toBe(100 + gap)
    expect(root2?.rect.x).toBe(100 + gap + 20 + gap)
  })

  it('pushes entire space groups (frame + owned nodes) together', () => {
    const gap = 24

    const next = pushAwayLayout({
      items: [
        {
          id: 'space-a',
          kind: 'space',
          groupId: 'space-a',
          rect: { x: 0, y: 0, width: 100, height: 100 },
        },
        {
          id: 'space-b',
          kind: 'space',
          groupId: 'space-b',
          rect: { x: 90, y: 0, width: 100, height: 100 },
        },
        {
          id: 'space-b-node',
          kind: 'node',
          groupId: 'space-b',
          rect: { x: 110, y: 10, width: 20, height: 20 },
        },
      ],
      pinnedGroupIds: ['space-a'],
      sourceGroupIds: ['space-a'],
      directions: ['x+'],
      gap,
    })

    const spaceB = next.find(item => item.id === 'space-b')
    const spaceBNode = next.find(item => item.id === 'space-b-node')
    expect(spaceB?.rect.x).toBe(100 + gap)
    expect(spaceBNode?.rect.x).toBe(110 + (100 + gap - 90))
  })

  it('reprocesses pinned groups when chain reactions push nodes into them', () => {
    const gap = 24

    const next = pushAwayLayout({
      items: [
        {
          id: 'pinned-right',
          kind: 'node',
          groupId: 'pinned-right',
          rect: { x: 300, y: 0, width: 100, height: 100 },
        },
        {
          id: 'pinned-left',
          kind: 'node',
          groupId: 'pinned-left',
          rect: { x: 0, y: 0, width: 100, height: 100 },
        },
        {
          id: 'mover-a',
          kind: 'node',
          groupId: 'mover-a',
          rect: { x: 80, y: 0, width: 100, height: 100 },
        },
        {
          id: 'mover-b',
          kind: 'node',
          groupId: 'mover-b',
          rect: { x: 200, y: 0, width: 100, height: 100 },
        },
      ],
      pinnedGroupIds: ['pinned-right', 'pinned-left'],
      sourceGroupIds: ['pinned-right', 'pinned-left'],
      directions: ['x+'],
      gap,
    })

    const moverB = next.find(item => item.id === 'mover-b')
    expect(moverB?.rect.x).toBe(400 + gap)
  })
})
