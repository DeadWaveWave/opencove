import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { Sidebar } from './Sidebar'

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  MeasuringStrategy: { Always: 0 },
  PointerSensor: vi.fn(),
  closestCenter: vi.fn(),
  pointerWithin: vi.fn(() => []),
  useSensor: vi.fn((_sensor: unknown, options?: unknown) => ({ options })),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: ({ id }: { id: string }) => ({
    attributes: { 'data-sortable-id': id },
    listeners: { 'data-drag-listener': 'true' },
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}))

function createWorkspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('Sidebar scroll state', () => {
  it('preserves the list scroll position when switching between docked and rail variants', () => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight',
    )
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight',
    )

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        if (this instanceof HTMLElement && this.classList.contains('workspace-sidebar__list')) {
          return 500
        }
        return 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        if (this instanceof HTMLElement && this.classList.contains('workspace-sidebar__list')) {
          return 100
        }
        return 0
      },
    })

    try {
      const workspaces = Array.from({ length: 10 }, (_, index) =>
        createWorkspace(`workspace-${index}`),
      )
      const { container, rerender } = render(
        <Sidebar
          workspaces={workspaces}
          activeWorkspaceId="workspace-0"
          persistNotice={null}
          onSelectWorkspace={() => undefined}
          onSelectSpace={() => undefined}
          onOpenProjectContextMenu={() => undefined}
          onSelectAgentNode={() => undefined}
          onReorderWorkspaces={() => undefined}
        />,
      )

      const dockedList = container.querySelector('.workspace-sidebar__list') as HTMLDivElement
      dockedList.scrollTop = 200
      fireEvent.scroll(dockedList)

      expect(dockedList.getAttribute('data-cove-scroll-fade')).toBe('both')

      rerender(
        <Sidebar
          variant="rail"
          workspaces={workspaces}
          activeWorkspaceId="workspace-0"
          persistNotice={null}
          onSelectWorkspace={() => undefined}
          onSelectSpace={() => undefined}
          onOpenProjectContextMenu={() => undefined}
          onSelectAgentNode={() => undefined}
          onReorderWorkspaces={() => undefined}
        />,
      )

      const railList = container.querySelector('.workspace-sidebar__list') as HTMLDivElement
      expect(railList).toBe(dockedList)
      expect(railList.scrollTop).toBe(200)
      expect(railList.getAttribute('data-cove-scroll-fade')).toBe('both')
    } finally {
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor)
      }
      if (clientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
      }
    }
  })
})
