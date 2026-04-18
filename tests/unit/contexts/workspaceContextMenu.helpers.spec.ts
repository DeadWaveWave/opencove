import { describe, expect, it } from 'vitest'
import {
  placeContextMenuAtPoint,
  placeSubmenuAtItem,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceContextMenu.helpers'

describe('workspace context menu placement', () => {
  it('keeps the root menu under the pointer when there is enough space', () => {
    expect(
      placeContextMenuAtPoint({
        point: { x: 820, y: 640 },
        menuSize: { width: 188, height: 220 },
        viewport: { width: 1440, height: 960 },
      }),
    ).toEqual({
      left: 820,
      top: 640,
    })
  })

  it('shifts the root menu minimally to keep it in the viewport', () => {
    expect(
      placeContextMenuAtPoint({
        point: { x: 1380, y: 910 },
        menuSize: { width: 188, height: 220 },
        viewport: { width: 1440, height: 960 },
      }),
    ).toEqual({
      left: 1240,
      top: 728,
    })
  })

  it('auto-aligns to the opposite corner when the preferred side would overflow', () => {
    expect(
      placeContextMenuAtPoint({
        point: { x: 1416, y: 932 },
        menuSize: { width: 188, height: 220 },
        viewport: { width: 1440, height: 960 },
        alignX: 'auto',
        alignY: 'auto',
      }),
    ).toEqual({
      left: 1228,
      top: 712,
    })
  })
})

describe('workspace context submenu placement', () => {
  it('prefers opening a submenu to the right of the parent item', () => {
    expect(
      placeSubmenuAtItem({
        parentMenuRect: { left: 820, top: 500, width: 188, height: 220 },
        itemRect: { left: 820, top: 586, width: 188, height: 34 },
        submenuSize: { width: 188, height: 260 },
        viewport: { width: 1440, height: 960 },
      }),
    ).toEqual({
      side: 'right',
      left: 1014,
      top: 586,
    })
  })

  it('flips a submenu to the left only when the right side overflows', () => {
    expect(
      placeSubmenuAtItem({
        parentMenuRect: { left: 1180, top: 500, width: 188, height: 220 },
        itemRect: { left: 1180, top: 586, width: 188, height: 34 },
        submenuSize: { width: 188, height: 260 },
        viewport: { width: 1440, height: 960 },
      }),
    ).toEqual({
      side: 'left',
      left: 986,
      top: 586,
    })
  })

  it('only shifts the submenu vertically as much as needed to stay visible', () => {
    expect(
      placeSubmenuAtItem({
        parentMenuRect: { left: 1180, top: 700, width: 188, height: 140 },
        itemRect: { left: 1180, top: 792, width: 188, height: 34 },
        submenuSize: { width: 188, height: 200 },
        viewport: { width: 1440, height: 960 },
      }),
    ).toEqual({
      side: 'left',
      left: 986,
      top: 748,
    })
  })
})
