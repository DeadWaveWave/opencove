import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SidebarSpaceGroupModel } from '../utils/sidebarTree'
import { SpaceItemOverlay } from './SidebarWorkspaceItem'

describe('SidebarWorkspaceItem', () => {
  it('renders a leaf space marker without disclosure semantics', () => {
    const leafGroup: SidebarSpaceGroupModel = {
      id: 'leaf-space',
      kind: 'space',
      name: 'Leaf space',
      labelColor: 'orange',
      space: {
        id: 'leaf-space',
        name: 'Leaf space',
        directoryPath: '/tmp/leaf-space',
        targetMountId: null,
        labelColor: 'orange',
        nodeIds: [],
        rect: null,
      },
      agents: [],
    }

    const { container } = render(<SpaceItemOverlay group={leafGroup} isExpanded />)
    const spaceItem = container.querySelector('.workspace-space-item')
    const railMarker = spaceItem?.querySelector('.workspace-space-item__rail-icon')

    expect(railMarker).not.toBeNull()
    expect(railMarker?.getAttribute('aria-hidden')).toBe('true')
    expect(railMarker?.classList.contains('workspace-tree-triangle')).toBe(false)
    expect(spaceItem?.querySelector('.workspace-space-item__toggle')).toBeNull()
    expect(spaceItem?.querySelector('.workspace-space-item__chevron')).toBeNull()
    expect(spaceItem?.getAttribute('aria-expanded')).toBeNull()
  })
})
