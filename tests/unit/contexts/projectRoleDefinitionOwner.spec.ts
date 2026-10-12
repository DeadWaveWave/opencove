import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  resolveNodeRoleDefinition,
  runRoleNodeAction,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run'

function createRoleNode(): Node<TerminalNodeData> {
  return {
    id: 'role-node-1',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      title: 'Product Manager',
      width: 360,
      height: 320,
      kind: 'role',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      role: {
        roleId: 'role-pm',
        roleName: 'Product Manager',
        roleDescription: 'Own requirements',
        promptTemplate: 'Write product requirements.',
        inputHint: 'Feature brief',
        outputFormat: 'PRD',
        input: '',
        selectedProvider: 'codex',
        linkedAgentNodeId: null,
        runHistory: [],
        createdAt: '2026-05-10T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
      image: null,
      document: null,
      website: null,
    },
  }
}

describe('resolveNodeRoleDefinition', () => {
  it('reads the authoritative role definition from project settings', () => {
    const role = resolveNodeRoleDefinition(createRoleNode(), [
      {
        id: 'role-pm',
        name: 'Product Manager',
        description: 'Own requirements',
        promptTemplate: 'Write product requirements.',
        inputHint: 'Feature brief',
        outputFormat: 'PRD',
        createdAt: '2026-05-10T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z',
      },
    ])

    expect(role).toMatchObject({
      id: 'role-pm',
      name: 'Product Manager',
      promptTemplate: 'Write product requirements.',
    })
  })

  it('does not fall back to executable node snapshot data when the project role is missing', () => {
    expect(resolveNodeRoleDefinition(createRoleNode(), [])).toBeNull()
  })

  it.each(['codex', 'claude-code'] as const)(
    'retains only authoritative %s launch identity on role-created nodes',
    async provider => {
      const node = createRoleNode()
      node.data.role!.selectedProvider = provider
      window.opencoveApi = {
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'runtime-role',
            resumeSessionId: 'assigned-role',
            effectiveModel: null,
          })),
        },
      } as unknown as typeof window.opencoveApi
      const createNodeForSession = vi.fn(async () => null)
      await runRoleNodeAction(node.id, undefined, {
        workspaceId: 'workspace',
        workspacePath: '/repo',
        agentSettings: DEFAULT_AGENT_SETTINGS,
        projectRoles: [
          {
            id: 'role-pm',
            name: 'PM',
            description: '',
            promptTemplate: 'Write requirements',
            inputHint: '',
            outputFormat: '',
            createdAt: '',
            updatedAt: '',
          },
        ],
        nodesRef: { current: [node] },
        spacesRef: { current: [] },
        setNodes: vi.fn(),
        onSpacesChange: vi.fn(),
        createNodeForSession,
        updateRoleInput: vi.fn(),
        appendRoleRunRecord: vi.fn(),
        buildAgentNodeTitle: () => 'Agent',
        t: key => key,
      })
      expect(createNodeForSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: expect.objectContaining({
            resumeSessionId: provider === 'claude-code' ? 'assigned-role' : null,
            resumeSessionIdVerified: provider === 'claude-code',
          }),
        }),
      )
    },
  )
})
