import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'

const { currentFlow } = vi.hoisted(() => ({
  currentFlow: { value: {} as Record<string, unknown> },
}))
vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => currentFlow.value,
}))

afterEach(() => vi.useRealTimers())

function renderNodesStore() {
  return renderHook(() => {
    const [nodes, setNodes] = useState<Node<TerminalNodeData>[]>([])
    return useWorkspaceCanvasNodesStore({
      nodes,
      spacesRef: useRef<WorkspaceSpaceState[]>([]),
      onNodesChange: setNodes,
      onSpacesChange: vi.fn(),
      standardWindowSizeBucket: DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
      browserDefaultMode: DEFAULT_AGENT_SETTINGS.browserDefaultMode,
    })
  })
}

function uninitializedViewport() {
  const setCenter = vi.fn(
    async (_x: number, _y: number, _options: unknown) =>
      currentFlow.value.viewportInitialized === true,
  )
  currentFlow.value = {
    viewportInitialized: false,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setCenter,
  }
  return setCenter
}

describe('created node viewport readiness', () => {
  it('retains creation focus until the viewport can accept it, then consumes it once', () => {
    vi.useFakeTimers()
    const setCenter = uninitializedViewport()
    const { result, rerender } = renderNodesStore()
    act(() => {
      result.current.createNoteNode({ x: 2400, y: 1800 })
    })
    act(() => vi.runOnlyPendingTimers())
    expect(setCenter).not.toHaveBeenCalled()

    currentFlow.value = { ...currentFlow.value, viewportInitialized: true }
    rerender()
    expect(setCenter).toHaveBeenCalledTimes(1)
    expect(setCenter.mock.calls[0][0]).toBeGreaterThan(2400)
    expect(setCenter.mock.calls[0][1]).toBeGreaterThan(1800)
    act(() => vi.runOnlyPendingTimers())
    currentFlow.value = { ...currentFlow.value }
    rerender()
    expect(setCenter).toHaveBeenCalledTimes(1)
  })

  it('focuses only the latest creation when several nodes precede viewport initialization', () => {
    vi.useFakeTimers()
    const setCenter = uninitializedViewport()
    const { result, rerender } = renderNodesStore()
    act(() => {
      result.current.createNoteNode({ x: 300, y: 200 })
    })
    act(() => {
      result.current.createNoteNode({ x: 2400, y: 1800 })
    })
    act(() => vi.runOnlyPendingTimers())
    expect(setCenter).not.toHaveBeenCalled()

    currentFlow.value = { ...currentFlow.value, viewportInitialized: true }
    rerender()
    expect(setCenter).toHaveBeenCalledTimes(1)
    expect(setCenter.mock.calls[0][0]).toBeGreaterThan(2400)
    expect(setCenter.mock.calls[0][1]).toBeGreaterThan(1800)
  })
})
