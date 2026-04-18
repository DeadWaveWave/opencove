import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasArrange } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useArrange'
import { useWorkspaceCanvasSpaces } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaces'

vi.mock('@xyflow/react', () => {
  return {
    getViewportForBounds: (
      _bounds: { x: number; y: number; width: number; height: number },
      _width: number,
      _height: number,
      _minZoom: number,
      maxZoom: number,
      _padding: number,
    ) => ({ x: 0, y: 0, zoom: maxZoom }),
    useStore: (selector: (state: unknown) => unknown) =>
      selector({ width: 1440, height: 900, minZoom: 0.1, maxZoom: 2 }),
  }
})

function createTerminalNode({
  id,
  position,
  size,
}: {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
}): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminalNode',
    position,
    data: {
      sessionId: `session-${id}`,
      title: id,
      width: size.width,
      height: size.height,
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
}

describe('workspace canvas space location zoom', () => {
  it('caps space focus zoom at focusNodeTargetZoom', () => {
    const setViewport = vi.fn(async () => undefined)
    const reactFlow = {
      setViewport,
      fitView: vi.fn(async () => undefined),
    }

    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
      }),
    ]
    const nodesRef = { current: nodes }

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        targetMountId: null,
        nodeIds: ['a'],
        rect: { x: 0, y: 0, width: 600, height: 400 },
      },
    ]
    const spacesRef = { current: spaces }

    const setNodes = vi.fn(
      (updater: (prev: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
        nodesRef.current = updater(nodesRef.current)
      },
    )

    function Harness(): React.JSX.Element {
      const [, setContextMenu] = React.useState<unknown>(null)
      const [, setEmptySelectionPrompt] = React.useState<unknown>(null)

      const { focusSpaceInViewport } = useWorkspaceCanvasSpaces({
        workspaceId: 'workspace-1',
        activeSpaceId: null,
        onActiveSpaceChange: () => undefined,
        workspacePath: '/tmp',
        focusNodeTargetZoom: 0.75,
        reactFlow: reactFlow as never,
        nodes,
        nodesRef,
        setNodes: setNodes as never,
        spaces,
        spacesRef,
        selectedNodeIds: [],
        selectedNodeIdsRef: { current: [] },
        onSpacesChange: () => undefined,
        setContextMenu: setContextMenu as never,
        setEmptySelectionPrompt: setEmptySelectionPrompt as never,
      })

      return (
        <button
          type="button"
          data-testid="focus-space"
          onClick={() => focusSpaceInViewport('space-1')}
        >
          Focus
        </button>
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByTestId('focus-space'))

    expect(setViewport).toHaveBeenCalled()
    const [viewport] = setViewport.mock.calls[0] ?? []
    expect(viewport).toEqual(expect.objectContaining({ zoom: 0.75 }))
  })

  it('focuses the arranged space instead of resetting to fitView', () => {
    const setViewport = vi.fn(async () => undefined)
    const fitView = vi.fn(async () => undefined)
    const reactFlow = {
      setViewport,
      fitView,
    }

    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame

    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()

    try {
      const nodes = [
        createTerminalNode({
          id: 'a',
          position: { x: 300, y: 300 },
          size: { width: 400, height: 280 },
        }),
        createTerminalNode({
          id: 'b',
          position: { x: 800, y: 310 },
          size: { width: 360, height: 260 },
        }),
        createTerminalNode({
          id: 'c',
          position: { x: 320, y: 700 },
          size: { width: 420, height: 300 },
        }),
      ]
      const nodesRef = { current: nodes }

      const spaces: WorkspaceSpaceState[] = [
        {
          id: 'space-1',
          name: 'Space 1',
          directoryPath: '/tmp',
          targetMountId: null,
          nodeIds: ['a', 'b', 'c'],
          rect: { x: 100, y: 200, width: 1200, height: 800 },
        },
      ]
      const spacesRef = { current: spaces }

      const setNodes = vi.fn(
        (updater: (prev: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
          nodesRef.current = updater(nodesRef.current)
        },
      )

      function Harness(): React.JSX.Element {
        const { arrangeInSpace } = useWorkspaceCanvasArrange({
          reactFlow: reactFlow as never,
          focusNodeTargetZoom: 1,
          nodesRef,
          spacesRef,
          setNodes: setNodes as never,
          onSpacesChange: () => undefined,
          standardWindowSizeBucket: 'regular',
        })

        return (
          <button
            type="button"
            data-testid="arrange-space"
            onClick={() => arrangeInSpace('space-1', { alignCanonicalSizes: false })}
          >
            Arrange
          </button>
        )
      }

      render(<Harness />)
      fireEvent.click(screen.getByTestId('arrange-space'))

      expect(fitView).not.toHaveBeenCalled()
      expect(setViewport).toHaveBeenCalled()
      const [viewport] = setViewport.mock.calls[0] ?? []
      expect(viewport).toEqual(expect.objectContaining({ zoom: 1 }))
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })
})
