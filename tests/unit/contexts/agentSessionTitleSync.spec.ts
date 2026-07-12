import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { AgentSessionSummary } from '../../../src/shared/contracts/dto'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  applyAgentSessionTitleToNodes,
  isAgentNodeAwaitingSessionTitle,
  loadAgentSessionTitle,
  resolveAgentSessionTitleSyncTarget,
} from '../../../src/contexts/workspace/presentation/renderer/utils/agentSessionTitleSync'

function createAgentNode(
  overrides: Partial<TerminalNodeData> & {
    agent?: Partial<NonNullable<TerminalNodeData['agent']>>
  } = {},
): Node<TerminalNodeData> {
  const { agent: agentOverrides, ...dataOverrides } = overrides

  return {
    id: 'agent-1',
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: 'runtime-1',
      title: 'codex · default',
      titlePinnedByUser: false,
      width: 520,
      height: 360,
      kind: 'agent',
      status: 'running',
      startedAt: '2026-07-12T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: {
        provider: 'codex',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: null,
        resumeSessionIdVerified: false,
        executionDirectory: '/tmp/project',
        expectedDirectory: '/tmp/project',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
        ...agentOverrides,
      },
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
      ...dataOverrides,
    },
  }
}

function createSessionSummary(title: string | null): AgentSessionSummary {
  return {
    sessionId: 'resume-1',
    provider: 'codex',
    cwd: '/tmp/project',
    title,
    startedAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:01.000Z',
    source: 'codex-file',
  }
}

describe('direct Agent session title sync', () => {
  it('waits only while an eligible direct Agent still has its launch title', () => {
    expect(
      isAgentNodeAwaitingSessionTitle(
        createAgentNode({
          title: 'codex · gpt-5.2-codex',
          agent: { model: 'gpt-5.2-codex', effectiveModel: 'gpt-5.2-codex' },
        }),
      ),
    ).toBe(true)
    expect(
      isAgentNodeAwaitingSessionTitle(
        createAgentNode({
          title: 'codex · Rename direct Agent windows',
          agent: { model: 'gpt-5.2-codex', effectiveModel: 'gpt-5.2-codex' },
        }),
      ),
    ).toBe(false)
  })

  it('creates a sync target only for an unpinned directly launched Agent', () => {
    expect(
      resolveAgentSessionTitleSyncTarget([createAgentNode()], {
        sessionId: 'runtime-1',
        resumeSessionId: 'resume-1',
      }),
    ).toEqual({
      nodeId: 'agent-1',
      runtimeSessionId: 'runtime-1',
      resumeSessionId: 'resume-1',
      provider: 'codex',
    })

    expect(
      resolveAgentSessionTitleSyncTarget([createAgentNode({ titlePinnedByUser: true })], {
        sessionId: 'runtime-1',
        resumeSessionId: 'resume-1',
      }),
    ).toBeNull()

    expect(
      resolveAgentSessionTitleSyncTarget([createAgentNode({ agent: { taskId: 'task-1' } })], {
        sessionId: 'runtime-1',
        resumeSessionId: 'resume-1',
      }),
    ).toBeNull()
  })

  it('ignores metadata that conflicts with an existing verified session binding', () => {
    const node = createAgentNode({
      agent: {
        resumeSessionId: 'resume-current',
        resumeSessionIdVerified: true,
      },
    })

    expect(
      resolveAgentSessionTitleSyncTarget([node], {
        sessionId: 'runtime-1',
        resumeSessionId: 'resume-stale',
      }),
    ).toBeNull()
  })

  it('updates the title only while the runtime and durable session still match', () => {
    const target = {
      nodeId: 'agent-1',
      runtimeSessionId: 'runtime-1',
      resumeSessionId: 'resume-1',
      provider: 'codex' as const,
    }
    const boundNode = createAgentNode({
      agent: {
        resumeSessionId: 'resume-1',
        resumeSessionIdVerified: true,
      },
    })

    const updated = applyAgentSessionTitleToNodes([boundNode], target, 'Fix Agent titles')
    expect(updated.didChange).toBe(true)
    expect(updated.nextNodes[0]?.data.title).toBe('codex · Fix Agent titles')

    const pinned = applyAgentSessionTitleToNodes(
      [{ ...boundNode, data: { ...boundNode.data, titlePinnedByUser: true } }],
      target,
      'Stale title',
    )
    expect(pinned.didChange).toBe(false)

    const switched = applyAgentSessionTitleToNodes(
      [
        createAgentNode({
          sessionId: 'runtime-2',
          agent: { resumeSessionId: 'resume-2', resumeSessionIdVerified: true },
        }),
      ],
      target,
      'Stale title',
    )
    expect(switched.didChange).toBe(false)
  })

  it('retries bounded session catalog reads until the exact session has a title', async () => {
    const listSessions = vi
      .fn<() => Promise<AgentSessionSummary[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createSessionSummary(null)])
      .mockResolvedValueOnce([createSessionSummary('Fix Agent titles')])
    const sleep = vi.fn(async () => undefined)

    const title = await loadAgentSessionTitle({
      resumeSessionId: 'resume-1',
      listSessions,
      retryDelaysMs: [0, 25, 75],
      sleep,
      isCurrent: () => true,
    })

    expect(title).toBe('Fix Agent titles')
    expect(listSessions).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('stops retrying when the target becomes stale', async () => {
    const listSessions = vi.fn(async () => [] as AgentSessionSummary[])
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)

    const title = await loadAgentSessionTitle({
      resumeSessionId: 'resume-1',
      listSessions,
      retryDelaysMs: [0, 25, 75],
      sleep: async () => undefined,
      isCurrent,
    })

    expect(title).toBeNull()
    expect(listSessions).toHaveBeenCalledTimes(1)
  })
})
