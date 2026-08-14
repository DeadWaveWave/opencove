import { describe, expect, it } from 'vitest'
import {
  mergeHydratedNode,
  prepareWorkspaceRuntimeNodes,
} from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { repairRuntimeNodeFrame } from '../../../src/app/renderer/shell/hooks/runtimeNodeFrameRepair'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

function createRuntimeNode(overrides: Partial<TerminalNodeData>): {
  id: string
  type: string
  position: { x: number; y: number }
  data: TerminalNodeData
} {
  return {
    id: 'terminal-node-1',
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      title: 'terminal',
      width: 520,
      height: 360,
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
      image: null,
      document: null,
      website: null,
      ...overrides,
    },
  }
}

describe('mergeHydratedNode', () => {
  it('keeps worker-prepared terminal geometry in the runtime node projection', () => {
    const merged = mergeHydratedNode(
      createRuntimeNode({ terminalGeometry: null }),
      createRuntimeNode({
        sessionId: 'runtime-session',
        terminalGeometry: { cols: 72, rows: 20 },
      }),
    )

    expect(merged.data.terminalGeometry).toEqual({ cols: 72, rows: 20 })
  })

  it('projects the worker-prepared terminal agent overlay state', () => {
    const merged = mergeHydratedNode(
      createRuntimeNode({
        terminalProviderHint: 'codex',
        agentOverlay: {
          provider: 'codex',
          status: 'restoring',
          startedAtMs: 1,
        },
      }),
      createRuntimeNode({
        sessionId: 'runtime-session',
        terminalProviderHint: 'codex',
        agentOverlay: {
          provider: 'codex',
          status: 'standby',
          startedAtMs: 2,
        },
      }),
    )

    expect(merged.data.agentOverlay).toEqual({
      provider: 'codex',
      status: 'standby',
      startedAtMs: 2,
    })
  })

  it('preserves a transient recovery issue across a late neutral hydration merge', () => {
    const merged = mergeHydratedNode(
      createRuntimeNode({
        kind: 'agent',
        recoveryIssue: 'codex_writer_locked',
      }),
      createRuntimeNode({
        kind: 'agent',
        recoveryIssue: null,
      }),
    )

    expect(merged.data.recoveryIssue).toBe('codex_writer_locked')
  })

  it('does not overwrite a concurrently switched verified resume binding', () => {
    const createAgent = (resumeSessionId: string) => ({
      provider: 'codex' as const,
      prompt: '',
      model: null,
      effectiveModel: null,
      launchMode: 'resume' as const,
      resumeSessionId,
      resumeSessionIdVerified: true,
      executionDirectory: '/repo',
      expectedDirectory: '/repo',
      directoryMode: 'workspace' as const,
      customDirectory: null,
      shouldCreateDirectory: false,
      taskId: null,
    })
    const merged = mergeHydratedNode(
      createRuntimeNode({ kind: 'agent', agent: createAgent('resume-target') }),
      createRuntimeNode({ kind: 'agent', agent: createAgent('resume-current') }),
    )

    expect(merged.data.agent?.resumeSessionId).toBe('resume-target')
    expect(merged.data.agent?.resumeSessionIdVerified).toBe(true)
  })

  it('keeps a provider-hinted overlay without inventing a manual recovery error', async () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        controlSurface: {
          invoke: async () => ({
            workspaceId: 'workspace-1',
            nodes: [
              {
                nodeId: 'terminal-node-1',
                kind: 'terminal',
                recoveryState: 'restarted',
                sessionId: 'fresh-shell-session',
                isLiveSessionReattach: false,
                title: 'codex',
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
                terminalGeometry: null,
                agent: null,
              },
            ],
          }),
        },
      },
    })

    const [hydrated] = await prepareWorkspaceRuntimeNodes({
      workspace: {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace',
        worktreesRoot: '',
        pullRequestBaseBranchOptions: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [],
        activeSpaceId: null,
        spaceArchiveRecords: [],
        nodes: [
          {
            id: 'terminal-node-1',
            sessionId: 'stale-session',
            title: 'codex',
            position: { x: 0, y: 0 },
            width: 520,
            height: 360,
            kind: 'terminal',
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            executionDirectory: '/tmp/workspace',
            expectedDirectory: '/tmp/workspace',
            terminalProviderHint: 'codex',
            terminalAgentBinding: null,
            agent: null,
            task: null,
          },
        ],
      } as never,
      agentSettings: {} as never,
    })

    expect(hydrated?.data.kind).toBe('terminal')
    expect(hydrated?.data.terminalAgentBinding).toBeNull()
    expect(hydrated?.data.agentOverlay).toMatchObject({
      provider: 'codex',
      status: 'standby',
    })
    expect(hydrated?.data.lastError).toBeNull()
  })
})

describe('repairRuntimeNodeFrame', () => {
  it('does not widen persisted OpenCode agent nodes beyond canonical agent sizing', () => {
    const repaired = repairRuntimeNodeFrame(
      createRuntimeNode({
        kind: 'agent',
        width: 516,
        height: 724,
        agent: {
          provider: 'opencode',
          prompt: '',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
          executionDirectory: 'D:\\Development\\opencove',
          expectedDirectory: 'D:\\Development\\opencove',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
      }) as never,
    )

    expect(repaired.data.width).toBe(516)
    expect(repaired.data.height).toBe(724)
    expect(repaired.initialWidth).toBeUndefined()
    expect(repaired.initialHeight).toBeUndefined()
  })

  it('repairs undersized agent nodes to the canonical minimum frame', () => {
    const repaired = repairRuntimeNodeFrame(
      createRuntimeNode({
        kind: 'agent',
        width: 360,
        height: 500,
        agent: {
          provider: 'opencode',
          prompt: '',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
          executionDirectory: 'D:\\Development\\opencove',
          expectedDirectory: 'D:\\Development\\opencove',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
      }) as never,
    )

    expect(repaired.data.width).toBe(400)
    expect(repaired.data.height).toBe(520)
    expect(repaired.initialWidth).toBe(400)
    expect(repaired.initialHeight).toBe(520)
  })
})
