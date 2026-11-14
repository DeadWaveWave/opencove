import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalGeometryEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../src/shared/contracts/dto'
import { usePtyWorkspaceRuntimeSync } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import { useWorkspaceCanvasPtyTaskCompletion } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from '../contexts/workspacePixelLayer.fixtures'

function agentWorkspace(): WorkspaceState {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace-1',
    worktreesRoot: '/tmp/workspace-1',
    nodes: [
      pixelNode({
        kind: 'agent',
        sessionId: 'session-1',
        status: 'running',
        agent: {
          provider: 'codex',
          prompt: 'Ship it',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
          executionDirectory: '/tmp/workspace-1',
          expectedDirectory: '/tmp/workspace-1',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
      }),
    ],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

function createPtySource() {
  const listeners = {
    data: new Set<(event: TerminalDataEvent) => void>(),
    exit: new Set<(event: TerminalExitEvent) => void>(),
    geometry: new Set<(event: TerminalGeometryEvent) => void>(),
    state: new Set<(event: TerminalSessionStateEvent) => void>(),
    metadata: new Set<(event: TerminalSessionMetadataEvent) => void>(),
    foreground: new Set<(event: never) => void>(),
  }
  const subscribe =
    <T,>(set: Set<(event: T) => void>) =>
    (listener: (event: T) => void) => {
      set.add(listener)
      return () => set.delete(listener)
    }
  return {
    api: {
      onData: subscribe(listeners.data),
      onExit: subscribe(listeners.exit),
      onGeometry: subscribe(listeners.geometry),
      onState: subscribe(listeners.state),
      onMetadata: subscribe(listeners.metadata),
      onForeground: subscribe(listeners.foreground),
      onResync: () => () => undefined,
    },
    emitExit: (event: TerminalExitEvent) => listeners.exit.forEach(listener => listener(event)),
    emitState: (event: TerminalSessionStateEvent) =>
      listeners.state.forEach(listener => listener(event)),
  }
}

// Shell runtime sync and the canvas task completion both observe the same PTY event hub, as in the app.
function renderObservers() {
  return renderHook(
    () => {
      const nodes = useAppStore(state => state.workspaces[0].nodes)
      const store = useWorkspaceCanvasNodesStore({
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        nodes,
        spacesRef: { current: [] },
        onNodesCommitted: () => undefined,
        isLiveGestureActive: () => false,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
      })
      usePtyWorkspaceRuntimeSync()
      useWorkspaceCanvasPtyTaskCompletion({
        workspaceId: 'workspace-1',
        nodes,
        setNodes: store.setNodes,
      })
    },
    { wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider> },
  )
}

describe('one PTY event is one store write', () => {
  const originalApi = window.opencoveApi
  let source: ReturnType<typeof createPtySource>

  beforeEach(() => {
    source = createPtySource()
    window.opencoveApi = { pty: source.api } as never
    useAppStore.setState({ workspaces: [agentWorkspace()], activeWorkspaceId: 'workspace-1' })
  })

  afterEach(() => {
    cleanup()
    window.opencoveApi = originalApi
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it('notifies store listeners once for a single agent exit', () => {
    renderObservers()
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    act(() => {
      source.emitExit({ sessionId: 'session-1', exitCode: 0 })
    })
    unsubscribe()

    expect(useAppStore.getState().workspaces[0].nodes[0].data.status).toBe('exited')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('notifies store listeners once for a single agent state change', () => {
    renderObservers()
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    act(() => {
      source.emitState({ sessionId: 'session-1', state: 'standby' })
    })
    unsubscribe()

    expect(
      useAppStore.getState().workspaces[0].nodes[0].data.agentRuntimeObservation,
    ).toMatchObject({ status: 'standby' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
