import React, { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import type {
  PrepareOrReviveSessionResult,
  PreparedRuntimeNodeResult,
} from '../../../src/shared/contracts/dto'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  mergeHydratedNode,
  prepareWorkspaceRuntimeNodes,
  toShellWorkspaceState,
} from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { installMockStorage } from '../../support/persistenceTestStorage'
import { toShellWorkspaceStateForSync } from '../../../src/app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'

function fixture() {
  return ensurePersistedWorkspace({
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    viewport: { x: 0, y: 0, zoom: 1 },
    spaces: [],
    activeSpaceId: null,
    nodes: ['slow', 'fast'].map(id => ({
      id,
      kind: 'terminal',
      sessionId: `${id}-existing`,
      title: id,
      width: 520,
      height: 360,
      position: { x: 0, y: 0 },
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
    })),
  })!
}

function prepared(nodeId: string): PreparedRuntimeNodeResult {
  return {
    nodeId,
    kind: 'terminal',
    recoveryState: 'live',
    sessionId: `${nodeId}-existing`,
    isLiveSessionReattach: true,
    title: nodeId,
    profileId: null,
    runtimeKind: 'posix',
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    executionDirectory: '/tmp/workspace',
    expectedDirectory: '/tmp/workspace',
    terminalGeometry: { cols: 80, rows: 24 },
    agent: null,
  }
}

describe('runtime hydration progress and durable bindings', () => {
  it.each(['restarted', ''])(
    'publishes recovery result %j before accepting shared runtime changes',
    async sessionId => {
      const persisted = fixture()
      let workspace = toShellWorkspaceState(persisted, { dropRuntimeSessionIds: true })
      Object.defineProperty(window, 'opencoveApi', {
        configurable: true,
        value: {
          controlSurface: {
            invoke: vi.fn(async () => ({
              workspaceId: persisted.id,
              nodes: [{ ...prepared('slow'), sessionId, isLiveSessionReattach: false }],
            })),
          },
        },
      })
      await prepareWorkspaceRuntimeNodes({
        workspace: persisted,
        nodeIds: ['slow'],
        agentSettings: DEFAULT_AGENT_SETTINGS,
        onNodePrepared: node => {
          workspace.nodes[0] = mergeHydratedNode(workspace.nodes[0]!, node)
        },
      })
      workspace = toShellWorkspaceStateForSync(persisted, workspace)
      expect(workspace.nodes[0]!.data.sessionId).toBe(sessionId)
      const published = toPersistedState([workspace], workspace.id).workspaces[0]!
      expect(published.nodes[0]!.sessionId).toBe(sessionId || undefined)
      workspace = toShellWorkspaceStateForSync(published, workspace)
      published.nodes[0]!.sessionId = 'switched-by-another-client'
      workspace = toShellWorkspaceStateForSync(published, workspace)
      expect(workspace.nodes[0]!.data.sessionId).toBe('switched-by-another-client')
    },
  )

  it('stops queued recovery and ignores pending results after hydration is cancelled', async () => {
    const workspace = fixture()
    workspace.nodes = Array.from({ length: 6 }, (_, index) => ({
      ...workspace.nodes[0]!,
      id: `node-${index}`,
    }))
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const invoke = vi.fn(async (request: { payload: { nodeIds: string[] } }) => {
      await gate
      return { workspaceId: workspace.id, nodes: [prepared(request.payload.nodeIds[0]!)] }
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { controlSurface: { invoke } },
    })
    let cancelled = false
    const onNodePrepared = vi.fn()
    const recovery = prepareWorkspaceRuntimeNodes({
      workspace,
      agentSettings: DEFAULT_AGENT_SETTINGS,
      isCancelled: () => cancelled,
      onNodePrepared,
    })
    expect(invoke).toHaveBeenCalledTimes(4)
    cancelled = true
    release()
    await recovery
    expect(invoke).toHaveBeenCalledTimes(4)
    expect(onNodePrepared).not.toHaveBeenCalled()
  })

  it('persists an unvalidated binding without attaching the placeholder to it', () => {
    const workspace = toShellWorkspaceState(fixture(), { dropRuntimeSessionIds: true })
    expect(workspace.nodes[0]!.data.sessionId).toBe('')
    const synced = toShellWorkspaceStateForSync(fixture(), workspace)
    expect(synced.nodes[0]!.data.sessionId).toBe('')
    expect(toPersistedState([synced], synced.id).workspaces[0]!.nodes[0]!.sessionId).toBe(
      'slow-existing',
    )
    expect(toPersistedState([workspace], workspace.id).workspaces[0]!.nodes[0]!.sessionId).toBe(
      'slow-existing',
    )
    const resolved = mergeHydratedNode(workspace.nodes[0]!, {
      ...workspace.nodes[0]!,
      data: { ...workspace.nodes[0]!.data, sessionId: '', runtimeSessionBinding: undefined },
    })
    workspace.nodes[0] = resolved
    expect(
      toPersistedState([workspace], workspace.id).workspaces[0]!.nodes[0]!.sessionId,
    ).toBeUndefined()
  })

  it('attaches a ready sibling while another request remains pending, and retains it after failure', async () => {
    const storage = installMockStorage()
    storage.setItem(
      'opencove:m0:workspace-state',
      JSON.stringify({
        activeWorkspaceId: 'workspace-1',
        workspaces: [fixture()],
        settings: {},
      }),
    )
    let rejectSlow!: (reason: unknown) => void
    const slow = new Promise<PrepareOrReviveSessionResult>((_resolve, reject) => {
      rejectSlow = reject
    })
    const invoke = vi.fn((request: { payload: { nodeIds: string[] } }) =>
      request.payload.nodeIds.includes('slow')
        ? slow
        : Promise.resolve({ workspaceId: 'workspace-1', nodes: [prepared('fast')] }),
    )
    const spawn = vi.fn()
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { controlSurface: { invoke }, pty: { spawn } },
    })
    const { useHydrateAppState } =
      await import('../../../src/app/renderer/shell/hooks/useHydrateAppState')
    function Harness() {
      const [settings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS)
      const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([])
      const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
      const { isHydrated } = useHydrateAppState({
        activeWorkspaceId,
        setAgentSettings,
        setWorkspaces,
        setActiveWorkspaceId,
      })
      return (
        <>
          <div data-testid="hydrated">{String(isHydrated)}</div>
          {workspaces[0]?.nodes.map(node => (
            <div key={node.id} data-testid={node.id}>
              {node.data.sessionId}
            </div>
          ))}
          <div data-testid="persisted">
            {JSON.stringify(toPersistedState(workspaces, activeWorkspaceId, settings))}
          </div>
        </>
      )
    }
    const rendered = render(<Harness />)
    try {
      await waitFor(() => expect(screen.getByTestId('fast')).toHaveTextContent('fast-existing'))
      expect(screen.getByTestId('slow')).toBeEmptyDOMElement()
      expect(screen.getByTestId('hydrated')).toHaveTextContent('false')
      expect(screen.getByTestId('persisted').textContent).toContain('slow-existing')
      await act(async () => rejectSlow(new Error('worker request timed out')))
      await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'))
      expect(screen.getByTestId('fast')).toHaveTextContent('fast-existing')
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      rejectSlow(new Error('test cleanup'))
    }
  })
})
