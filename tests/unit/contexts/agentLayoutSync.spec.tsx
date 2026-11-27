import React, { useEffect } from 'react'
import { act, waitFor } from '@testing-library/react'
import {
  CANVAS_STORE_TEST_WORKSPACE_ID,
  renderWithCanvasStore,
} from '../../support/canvasStoreTestHarness'
import { createCanvasDocumentHarness } from '../../support/canvasDocumentHarness'
import { storeBackedChannelsOf } from '../../support/workspaceCanvasStoreHarness'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { createAgentSettingsReader } from '../../support/agentSettingsReader'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'
import { useWorkspaceCanvasPtyTaskCompletion } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'

vi.mock('@app/renderer/i18n', () => {
  return {
    useTranslation: () => ({
      t: (key: string, params?: { message?: string }) =>
        params?.message ? `${key}: ${params.message}` : key,
    }),
  }
})

function createAgentNode(): Node<TerminalNodeData> {
  return {
    id: 'agent-1',
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      profileId: 'wsl:Ubuntu',
      runtimeKind: 'wsl',
      title: 'codex · default',
      width: 520,
      height: 360,
      kind: 'agent',
      status: 'standby',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: {
        provider: 'codex',
        prompt: 'ship it',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: '/tmp/project',
        expectedDirectory: '/tmp/project',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
      note: null,
      image: null,
    },
    draggable: true,
    selectable: true,
  }
}

// What `syncLayout: false` means to the canvas's writer: no layout sync event while the workspace
// is shown. The hooks take the writer from context, so a spy on its calls is the event itself.
function trackLayoutSyncs(): { count: () => number; stop: () => void } {
  useAppStore.setState({ activeWorkspaceId: CANVAS_STORE_TEST_WORKSPACE_ID })
  const listener = vi.fn()
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, listener)
  return {
    count: () => listener.mock.calls.length,
    stop: () => window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, listener),
  }
}

describe('agent terminal layout sync', () => {
  it('does not trigger layout sync during agent lifecycle status updates', async () => {
    createCanvasDocumentHarness({
      workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
      nodes: [createAgentNode()],
    })
    const { nodesRef } = storeBackedChannelsOf(CANVAS_STORE_TEST_WORKSPACE_ID)
    const layoutSyncs = trackLayoutSyncs()

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'agent-session-1',
            profileId: 'wsl:Ubuntu',
            runtimeKind: 'wsl',
            command: 'wsl.exe',
            args: ['--distribution', 'Ubuntu'],
            launchMode: 'new',
            effectiveModel: 'gpt-5.2-codex',
            resumeSessionId: null,
          })),
        },
        pty: {
          kill: vi.fn(async () => undefined),
        },
        workspace: {
          ensureDirectory: vi.fn(async () => undefined),
        },
      },
    })

    function Harness(): React.ReactElement | null {
      const { launchAgentInNode } = useWorkspaceCanvasAgentNodeLifecycle({
        workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
        workspacePath: '/tmp/project',
        bumpAgentLaunchToken: () => 1,
        isAgentLaunchTokenCurrent: () => true,
        readAgentSettings: createAgentSettingsReader({
          agentFullAccess: true,
          codexReuseRunningAppServer: false,
          defaultTerminalProfileId: 'wsl:Ubuntu',
          agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
        }),
        terminalDisplayCalibration: null,
      })

      useEffect(() => {
        void launchAgentInNode('agent-1', 'new')
      }, [launchAgentInNode])

      return null
    }

    renderWithCanvasStore(<Harness />)

    await waitFor(() => {
      expect(window.opencoveApi.agent.launch).toHaveBeenCalledTimes(1)
    })

    // The launch writes twice (restoring, then bound to its session); neither syncs the layout.
    await waitFor(() => {
      expect(nodesRef.current[0]?.data.sessionId).toBe('agent-session-1')
    })
    layoutSyncs.stop()
    expect(layoutSyncs.count()).toBe(0)
  })

  it('leaves agent runtime state events to the shell writer, so the canvas never syncs layout for them', async () => {
    let onStateListener:
      | ((event: { sessionId: string; state: 'running' | 'standby' }) => void)
      | null = null

    createCanvasDocumentHarness({
      workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
      nodes: [createAgentNode()],
    })
    const writes = vi.fn()
    const unsubscribeWrites = useAppStore.subscribe(writes)

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          onData: vi.fn(() => () => undefined),
          onExit: vi.fn(() => () => undefined),
          onState: vi.fn((listener: typeof onStateListener) => {
            onStateListener = listener
            return () => {
              onStateListener = null
            }
          }),
          onMetadata: vi.fn(() => () => undefined),
        },
      },
    })

    function Harness(): null {
      useWorkspaceCanvasPtyTaskCompletion({})
      return null
    }

    renderWithCanvasStore(<Harness />)

    act(() => {
      onStateListener?.({ sessionId: 'agent-session-1', state: 'running' })
    })

    // Moved from "setNodes called once with { syncLayout: false }": the shell writer now owns this
    // write (ptyRuntimeObservation.singleWriter.spec.tsx asserts no layout sync event for it).
    unsubscribeWrites()
    expect(writes).not.toHaveBeenCalled()
  })

  it('updates a directly launched Agent title after session metadata resolves', async () => {
    let onMetadataListener:
      | ((event: { sessionId: string; resumeSessionId: string | null }) => void)
      | null = null
    const node = createAgentNode()
    node.data.sessionId = 'runtime-1'
    const documentHarness = createCanvasDocumentHarness({
      workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID,
      nodes: [node],
    })
    const { nodesRef } = storeBackedChannelsOf(CANVAS_STORE_TEST_WORKSPACE_ID)
    const layoutSyncs = trackLayoutSyncs()
    const listAgentSessions = vi.fn(async () => [
      {
        sessionId: 'resume-1',
        provider: 'codex' as const,
        cwd: '/tmp/project',
        title: 'Rename direct Agent windows',
        startedAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:01.000Z',
        source: 'codex-file' as const,
      },
    ])
    // The shell's persist flush, as the document module calls it.
    const onRequestPersistFlush = documentHarness.flush

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          onData: vi.fn(() => () => undefined),
          onExit: vi.fn(() => () => undefined),
          onState: vi.fn(() => () => undefined),
          onMetadata: vi.fn((listener: typeof onMetadataListener) => {
            onMetadataListener = listener
            return () => {
              onMetadataListener = null
            }
          }),
        },
      },
    })

    function Harness(): null {
      useWorkspaceCanvasPtyTaskCompletion({
        listAgentSessions,
      })
      return null
    }

    renderWithCanvasStore(<Harness />)

    act(() => {
      onMetadataListener?.({ sessionId: 'runtime-1', resumeSessionId: 'resume-1' })
    })

    await waitFor(() => {
      expect(nodesRef.current[0]?.data.title).toBe('codex · Rename direct Agent windows')
    })

    expect(listAgentSessions).toHaveBeenCalledWith('agent-1', 20)
    expect(onRequestPersistFlush).toHaveBeenCalledTimes(2)
    layoutSyncs.stop()
    expect(layoutSyncs.count()).toBe(0)
  })

  it('restarts an unresolved title lookup immediately when the Agent enters standby', async () => {
    vi.useFakeTimers()
    try {
      let onStateListener:
        | ((event: { sessionId: string; state: 'working' | 'standby' }) => void)
        | null = null
      let onMetadataListener:
        | ((event: { sessionId: string; resumeSessionId: string | null }) => void)
        | null = null
      const node = createAgentNode()
      node.data.sessionId = 'runtime-1'
      node.data.title = 'codex · gpt-5.2-codex'
      createCanvasDocumentHarness({ workspaceId: CANVAS_STORE_TEST_WORKSPACE_ID, nodes: [node] })
      const { nodesRef } = storeBackedChannelsOf(CANVAS_STORE_TEST_WORKSPACE_ID)
      const listAgentSessions = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            sessionId: 'resume-1',
            provider: 'codex' as const,
            cwd: '/tmp/project',
            title: 'Short first session',
            startedAt: '2026-07-12T00:00:00.000Z',
            updatedAt: '2026-07-12T00:00:01.000Z',
            source: 'codex-file' as const,
          },
        ])

      Object.defineProperty(window, 'opencoveApi', {
        configurable: true,
        writable: true,
        value: {
          pty: {
            onData: vi.fn(() => () => undefined),
            onExit: vi.fn(() => () => undefined),
            onState: vi.fn((listener: typeof onStateListener) => {
              onStateListener = listener
              return () => {
                onStateListener = null
              }
            }),
            onMetadata: vi.fn((listener: typeof onMetadataListener) => {
              onMetadataListener = listener
              return () => {
                onMetadataListener = null
              }
            }),
          },
        },
      })

      function Harness(): null {
        useWorkspaceCanvasPtyTaskCompletion({
          listAgentSessions,
        })
        return null
      }

      renderWithCanvasStore(<Harness />)

      await act(async () => {
        onMetadataListener?.({ sessionId: 'runtime-1', resumeSessionId: 'resume-1' })
        await Promise.resolve()
      })
      expect(listAgentSessions).toHaveBeenCalledTimes(1)

      await act(async () => {
        onStateListener?.({ sessionId: 'runtime-1', state: 'standby' })
        await Promise.resolve()
      })

      expect(listAgentSessions).toHaveBeenCalledTimes(2)
      expect(nodesRef.current[0]?.data.title).toBe('codex · Short first session')
    } finally {
      vi.useRealTimers()
    }
  })
})
