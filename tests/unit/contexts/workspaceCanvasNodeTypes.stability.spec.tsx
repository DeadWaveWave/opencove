import React, { useEffect } from 'react'
import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceCanvasNodeTypeProps } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.types'

const taskMounts = vi.fn()

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.task',
  () => ({
    WorkspaceCanvasTaskNodeType: ({ workspacePath }: { workspacePath: string }) => {
      useEffect(() => {
        taskMounts()
      }, [])
      return <div data-testid="task-node">{workspacePath}</div>
    },
  }),
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodePosition',
  () => ({ useNodePosition: () => ({ x: 0, y: 0 }) }),
)

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation',
  () => ({
    WindowCollapsePresentation: ({
      children,
      onSelect,
    }: {
      children: React.ReactNode
      onSelect: () => void
    }) => (
      <div>
        <button type="button" onClick={onSelect}>
          select
        </button>
        {children}
      </div>
    ),
  }),
)

const { useWorkspaceCanvasNodeTypes } =
  await import('../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes')

type NodeTypesParams = Parameters<typeof useWorkspaceCanvasNodeTypes>[0]

function createParams(overrides: Partial<NodeTypesParams>): NodeTypesParams {
  const ref = <T,>(value: T) => ({ current: value })
  const noop = () => undefined
  const asyncNoop = async () => undefined
  return {
    spacesRef: ref([]),
    workspacePath: '/projects/a',
    agentProviderOrder: ['claude-code'],
    defaultProvider: 'claude-code',
    browserDefaultMode: 'embedded',
    browserSearchEngine: 'google',
    selectNode: vi.fn(),
    convertNoteToTask: () => false,
    setNodeLabelColorOverride: noop,
    clearNodeSelectionRef: ref(noop),
    closeNodeRef: ref(asyncNoop),
    resizeNodeRef: ref(noop),
    copyAgentLastMessageRef: ref(asyncNoop),
    reloadAgentSessionRef: ref(asyncNoop),
    listAgentSessionsRef: ref(async () => []),
    switchAgentSessionRef: ref(asyncNoop),
    updateNoteTextRef: ref(noop),
    renameNoteTitleRef: ref(noop),
    updateRoleProviderRef: ref(noop),
    updateRoleInputRef: ref(noop),
    runRoleRef: ref(asyncNoop),
    updateNodeScrollbackRef: ref(noop),
    normalizeViewportForTerminalInteractionRef: ref(noop),
    requestNodeDeleteRef: ref(noop),
    openTaskEditorRef: ref(noop),
    quickUpdateTaskTitleRef: ref(noop),
    quickUpdateTaskRequirementRef: ref(noop),
    runTaskAgentRef: ref(asyncNoop),
    resumeTaskAgentSessionRef: ref(asyncNoop),
    removeTaskAgentSessionRecordRef: ref(noop),
    updateTaskStatusRef: ref(noop),
    updateTerminalTitleRef: ref(noop),
    clearTerminalAgentOverlayRef: ref(noop),
    renameTerminalTitleRef: ref(noop),
    updateWebsiteUrlRef: ref(noop),
    setWebsitePinnedRef: ref(noop),
    setWebsiteSessionRef: ref(noop),
    setWebsiteModeRef: ref(noop),
    setWebsiteFullscreenRef: ref(noop),
    ...overrides,
  } as unknown as NodeTypesParams
}

describe('workspace canvas node types', () => {
  it('keep their identity when workspace values change, so React Flow does not remount nodes', () => {
    const { result, rerender } = renderHook(
      (params: NodeTypesParams) => useWorkspaceCanvasNodeTypes(params),
      { initialProps: createParams({ workspacePath: '/projects/a' }) },
    )
    const initialTypes = result.current

    rerender(createParams({ workspacePath: '/projects/b', selectNode: vi.fn() }))

    expect(result.current).toBe(initialTypes)
    for (const [type, component] of Object.entries(result.current)) {
      expect(component, type).toBe(initialTypes[type])
    }
  })

  it('re-render mounted nodes with the latest values instead of remounting them', () => {
    taskMounts.mockClear()
    const firstSelect = vi.fn()
    const secondSelect = vi.fn()
    let params = createParams({ workspacePath: '/projects/a', selectNode: firstSelect })

    function Canvas(): React.JSX.Element {
      const nodeTypes = useWorkspaceCanvasNodeTypes(params)
      const TaskNode = nodeTypes.taskNode
      const props = { id: 'task-1', data: {} } as unknown as WorkspaceCanvasNodeTypeProps
      return <TaskNode {...props} />
    }

    const view = render(<Canvas />)
    expect(view.getByTestId('task-node').textContent).toBe('/projects/a')

    params = createParams({ workspacePath: '/projects/b', selectNode: secondSelect })
    act(() => {
      view.rerender(<Canvas />)
    })

    expect(view.getByTestId('task-node').textContent).toBe('/projects/b')
    expect(taskMounts).toHaveBeenCalledTimes(1)

    fireEvent.click(view.getByText('select'))
    expect(secondSelect).toHaveBeenCalledWith('task-1')
    expect(firstSelect).not.toHaveBeenCalled()
  })
})
