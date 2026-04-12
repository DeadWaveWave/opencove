import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { Sidebar } from './Sidebar'

const dndState = vi.hoisted(() => ({
  draggingId: null as string | null,
  onDragStart: null as ((event: { active: { id: string } }) => void) | null,
  onDragEnd: null as
    | ((event: { active: { id: string }; over: { id: string } | null }) => void)
    | null,
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragStart,
    onDragEnd,
  }: {
    children: React.ReactNode
    onDragStart?: (event: { active: { id: string } }) => void
    onDragEnd?: (event: { active: { id: string }; over: { id: string } | null }) => void
  }) => {
    dndState.onDragStart = onDragStart ?? null
    dndState.onDragEnd = onDragEnd ?? null
    return <>{children}</>
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: vi.fn(),
  closestCenter: vi.fn(),
  useSensor: vi.fn((_sensor: unknown, options?: unknown) => ({ options })),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: ({ id }: { id: string }) => ({
    attributes: { 'data-sortable-id': id },
    listeners: { 'data-drag-listener': 'true' },
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: dndState.draggingId === id,
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

function createWorkspace(id: string, options?: { hasAgent?: boolean }): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes: options?.hasAgent
      ? [
          {
            id: `${id}-agent`,
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            data: {
              sessionId: `${id}-session`,
              title: `${id} agent`,
              width: 320,
              height: 240,
              kind: 'agent',
              status: 'running',
              startedAt: '2026-03-29T10:00:00.000Z',
              endedAt: null,
              exitCode: null,
              lastError: null,
              scrollback: null,
              executionDirectory: `/tmp/${id}`,
              expectedDirectory: `/tmp/${id}`,
              agent: {
                provider: 'codex',
                prompt: 'ship it',
                model: 'gpt-5.2-codex',
                effectiveModel: 'gpt-5.2-codex',
                launchMode: 'new',
                resumeSessionId: null,
                executionDirectory: `/tmp/${id}`,
                expectedDirectory: `/tmp/${id}`,
                directoryMode: 'workspace',
                customDirectory: null,
                shouldCreateDirectory: false,
                taskId: null,
              },
              task: null,
              note: null,
              image: null,
              document: null,
              website: null,
            },
            type: 'default',
            measured: { width: 320, height: 240 },
            selected: false,
            dragging: false,
            deletable: true,
          },
        ]
      : [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('Sidebar', () => {
  beforeEach(() => {
    dndState.draggingId = null
    dndState.onDragStart = null
    dndState.onDragEnd = null
  })

  it('renders a drag overlay, dims the dragged item, and reorders on drag end', () => {
    const onReorderWorkspaces = vi.fn()
    const { container } = render(
      <Sidebar
        workspaces={[createWorkspace('workspace-a'), createWorkspace('workspace-b')]}
        activeWorkspaceId="workspace-a"
        activeProviderLabel="Codex"
        activeProviderModel="gpt-5.2-codex"
        persistNotice={null}
        onAddWorkspace={() => undefined}
        onSelectWorkspace={() => undefined}
        onOpenProjectContextMenu={() => undefined}
        onSelectAgentNode={() => undefined}
        onReorderWorkspaces={onReorderWorkspaces}
      />,
    )

    act(() => {
      dndState.draggingId = 'workspace-b'
      dndState.onDragStart?.({ active: { id: 'workspace-b' } })
    })

    const overlayElement = container.querySelector('.workspace-item--drag-overlay')
    expect(overlayElement).not.toBeNull()
    expect(overlayElement?.textContent).toContain('workspace-b')

    const draggedGroup = screen
      .getByTestId('workspace-item-workspace-b')
      .closest('.workspace-item-group')
    expect(draggedGroup).not.toBeNull()
    expect((draggedGroup as HTMLElement).style.opacity).toBe('0.4')

    act(() => {
      dndState.draggingId = null
      dndState.onDragEnd?.({
        active: { id: 'workspace-b' },
        over: { id: 'workspace-a' },
      })
    })

    expect(onReorderWorkspaces).toHaveBeenCalledWith('workspace-b', 'workspace-a')
    expect(container.querySelector('.workspace-item--drag-overlay')).toBeNull()
  })

  it('keeps workspace clicks, context menus, and nested agent clicks working', () => {
    const onSelectWorkspace = vi.fn()
    const onOpenProjectContextMenu = vi.fn()
    const onSelectAgentNode = vi.fn()

    render(
      <Sidebar
        workspaces={[createWorkspace('workspace-a', { hasAgent: true })]}
        activeWorkspaceId="workspace-a"
        activeProviderLabel="Codex"
        activeProviderModel="gpt-5.2-codex"
        persistNotice={null}
        onAddWorkspace={() => undefined}
        onSelectWorkspace={onSelectWorkspace}
        onOpenProjectContextMenu={onOpenProjectContextMenu}
        onSelectAgentNode={onSelectAgentNode}
        onReorderWorkspaces={() => undefined}
      />,
    )

    const workspaceButton = screen.getByTestId('workspace-item-workspace-a')
    const agentButton = screen.getByTestId('workspace-agent-item-workspace-a-workspace-a-agent')

    expect(workspaceButton.getAttribute('data-drag-listener')).toBe('true')
    expect(agentButton.getAttribute('data-drag-listener')).toBeNull()

    fireEvent.click(workspaceButton)
    expect(onSelectWorkspace).toHaveBeenCalledWith('workspace-a')

    fireEvent.contextMenu(workspaceButton, { clientX: 120, clientY: 220 })
    expect(onOpenProjectContextMenu).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      x: 120,
      y: 220,
    })

    fireEvent.click(agentButton)
    expect(onSelectAgentNode).toHaveBeenCalledWith('workspace-a', 'workspace-a-agent')
  })
})
