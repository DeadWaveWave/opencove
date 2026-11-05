import type { Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateAgentNode } from '../../../src/contexts/agent/presentation/renderer/hydrateAgentNode'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
} from '../../../src/contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

const assignedSessionId = '11111111-1111-4111-8111-111111111111'
const launch = vi.fn()
const spawn = vi.fn()

function blankAgent(provider: AgentProvider): Node<TerminalNodeData> {
  return {
    id: 'agent',
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      title: 'Agent',
      width: 520,
      height: 360,
      kind: 'agent',
      status: 'standby',
      startedAt: '2026-05-01T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: {
        provider,
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: null,
        resumeSessionIdVerified: false,
        executionDirectory: '/test/workspace',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
    },
  }
}

beforeEach(() => {
  launch.mockReset()
  spawn.mockReset()
  launch.mockImplementation(async ({ provider, mode }) => ({
    sessionId: 'test-pty',
    provider,
    launchMode: mode,
    effectiveModel: null,
    resumeSessionId: assignedSessionId,
  }))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      agent: {
        launch,
        resolveResumeSessionId: vi.fn(async () => ({ resumeSessionId: null })),
      },
      pty: { spawn },
    },
  })
})

describe('legacy local agent hydration binding', () => {
  it('preserves a new Claude assignment and resumes that exact identity on the next hydration', async () => {
    const hydrated = await hydrateAgentNode({
      node: blankAgent('claude-code'),
      workspacePath: '/test/workspace',
      agentSettings: DEFAULT_AGENT_SETTINGS,
    })
    expect(launch).toHaveBeenNthCalledWith(1, expect.objectContaining({ mode: 'new' }))
    expect(hydrated.data.agent).toMatchObject({
      resumeSessionId: assignedSessionId,
      resumeSessionIdVerified: true,
    })

    await hydrateAgentNode({
      node: JSON.parse(JSON.stringify(hydrated)),
      workspacePath: '/test/workspace',
      agentSettings: DEFAULT_AGENT_SETTINGS,
    })
    expect(launch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'resume', resumeSessionId: assignedSessionId }),
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['codex', 'gemini', 'opencode', 'kimi', 'pi'] as const)(
    'leaves a new %s launch unverified until its authoritative observation arrives',
    async provider => {
      const hydrated = await hydrateAgentNode({
        node: blankAgent(provider),
        workspacePath: '/test/workspace',
        agentSettings: DEFAULT_AGENT_SETTINGS,
      })
      expect(hydrated.data.agent).toMatchObject({
        resumeSessionId: null,
        resumeSessionIdVerified: false,
      })
      expect(spawn).not.toHaveBeenCalled()
    },
  )
})

describe('persisted agentFullAccess during hydration', () => {
  const fullAccessSettings = { ...DEFAULT_AGENT_SETTINGS, agentFullAccess: true }
  const offSettings = { ...DEFAULT_AGENT_SETTINGS, agentFullAccess: false }

  function withAgent(
    node: Node<TerminalNodeData>,
    patch: Partial<NonNullable<TerminalNodeData['agent']>>,
  ): Node<TerminalNodeData> {
    return { ...node, data: { ...node.data, agent: { ...node.data.agent!, ...patch } } }
  }

  it('relaunches a blank agent with its persisted explicit false over a global true', async () => {
    const hydrated = await hydrateAgentNode({
      node: withAgent(blankAgent('claude-code'), { agentFullAccess: false }),
      workspacePath: '/test/workspace',
      agentSettings: fullAccessSettings,
    })

    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'new', agentFullAccess: false }),
    )
    expect(hydrated.data.agent).toMatchObject({ agentFullAccess: false })
  })

  it('resumes a verified agent with its persisted explicit true over a global false', async () => {
    await hydrateAgentNode({
      node: withAgent(blankAgent('claude-code'), {
        agentFullAccess: true,
        resumeSessionId: assignedSessionId,
        resumeSessionIdVerified: true,
      }),
      workspacePath: '/test/workspace',
      agentSettings: offSettings,
    })

    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'resume',
        resumeSessionId: assignedSessionId,
        agentFullAccess: true,
      }),
    )
  })

  it('resumes with the persisted explicit false when the global setting is on', async () => {
    await hydrateAgentNode({
      node: withAgent(blankAgent('claude-code'), {
        agentFullAccess: false,
        resumeSessionId: assignedSessionId,
        resumeSessionIdVerified: true,
      }),
      workspacePath: '/test/workspace',
      agentSettings: fullAccessSettings,
    })

    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'resume', agentFullAccess: false }),
    )
  })

  it('keeps following the global setting for legacy agents without the field', async () => {
    await hydrateAgentNode({
      node: blankAgent('claude-code'),
      workspacePath: '/test/workspace',
      agentSettings: offSettings,
    })

    expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ agentFullAccess: false }))
  })

  it('never rewrites the persisted explicit value during runtime observation', async () => {
    const hydrated = await hydrateAgentNode({
      node: withAgent(blankAgent('claude-code'), { agentFullAccess: false }),
      workspacePath: '/test/workspace',
      agentSettings: fullAccessSettings,
    })

    expect(hydrated.data.agent?.agentFullAccess).toBe(false)
  })
})
