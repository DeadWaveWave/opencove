import React, { useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
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

describe('agent terminal layout sync', () => {
  it('does not trigger layout sync during agent lifecycle status updates', async () => {
    const nodesRef = {
      current: [createAgentNode()],
    } as React.MutableRefObject<Node<TerminalNodeData>[]>
    const spacesRef = { current: [] } as React.MutableRefObject<WorkspaceSpaceState[]>

    const setNodes = vi.fn(
      (
        updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
        _options?: { syncLayout?: boolean },
      ) => {
        nodesRef.current = updater(nodesRef.current)
      },
    )

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

    function Harness(): null {
      const { launchAgentInNode } = useWorkspaceCanvasAgentNodeLifecycle({
        nodesRef,
        spacesRef,
        setNodes,
        bumpAgentLaunchToken: () => 1,
        isAgentLaunchTokenCurrent: () => true,
        agentFullAccess: true,
        defaultTerminalProfileId: 'wsl:Ubuntu',
        agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
      })

      useEffect(() => {
        void launchAgentInNode('agent-1', 'new')
      }, [launchAgentInNode])

      return null
    }

    render(<Harness />)

    await waitFor(() => {
      expect(window.opencoveApi.agent.launch).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(setNodes).toHaveBeenCalledTimes(2)
    })

    expect(setNodes.mock.calls.map(call => call[1])).toEqual([
      { syncLayout: false },
      { syncLayout: false },
    ])
  })

  it('does not trigger layout sync for agent runtime state events', async () => {
    let onStateListener:
      | ((event: { sessionId: string; state: 'running' | 'standby' }) => void)
      | null = null

    const setNodes = vi.fn()

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
      useWorkspaceCanvasPtyTaskCompletion({
        setNodes,
      })
      return null
    }

    render(<Harness />)

    onStateListener?.({ sessionId: 'agent-session-1', state: 'running' })

    await waitFor(() => {
      expect(setNodes).toHaveBeenCalledTimes(1)
    })

    expect(setNodes.mock.calls[0]?.[1]).toEqual({ syncLayout: false })
  })

  it('updates a directly launched Agent title after session metadata resolves', async () => {
    let onMetadataListener:
      | ((event: { sessionId: string; resumeSessionId: string | null }) => void)
      | null = null
    const node = createAgentNode()
    node.data.sessionId = 'runtime-1'
    const nodesRef = {
      current: [node],
    } as React.MutableRefObject<Node<TerminalNodeData>[]>
    const setNodes = vi.fn(
      (
        updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
        _options?: { syncLayout?: boolean },
      ) => {
        nodesRef.current = updater(nodesRef.current)
      },
    )
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
    const onRequestPersistFlush = vi.fn()

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
        nodesRef,
        setNodes,
        listAgentSessions,
        onRequestPersistFlush,
      })
      return null
    }

    render(<Harness />)

    act(() => {
      onMetadataListener?.({ sessionId: 'runtime-1', resumeSessionId: 'resume-1' })
    })

    await waitFor(() => {
      expect(nodesRef.current[0]?.data.title).toBe('codex · Rename direct Agent windows')
    })

    expect(listAgentSessions).toHaveBeenCalledWith('agent-1', 20)
    expect(onRequestPersistFlush).toHaveBeenCalledTimes(2)
    expect(setNodes.mock.calls.every(call => call[1]?.syncLayout === false)).toBe(true)
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
      const nodesRef = {
        current: [node],
      } as React.MutableRefObject<Node<TerminalNodeData>[]>
      const setNodes = vi.fn(
        (
          updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
          _options?: { syncLayout?: boolean },
        ) => {
          nodesRef.current = updater(nodesRef.current)
        },
      )
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
          nodesRef,
          setNodes,
          listAgentSessions,
        })
        return null
      }

      render(<Harness />)

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
