import { expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  runRoleNodeAction,
  type RoleRunActionContext,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

it('refused role preserves input and history before mount resolution or launch', async () => {
  const nodesRef = {
    current: [
      {
        id: 'role',
        data: {
          kind: 'role',
          role: {
            roleId: 'definition',
            input: '',
            selectedProvider: 'claude-code',
            runHistory: [],
            linkedAgentNodeId: null,
          },
        },
      },
    ] as unknown as Node<TerminalNodeData>[],
  }
  const onSpacesChange = vi.fn()
  const createNodeForSession = vi.fn()
  await runRoleNodeAction('role', undefined, {
    nodesRef,
    spacesRef: { current: [] },
    agentSettings: DEFAULT_AGENT_SETTINGS,
    projectRoles: [{ id: 'definition', promptTemplate: 'update' }],
    setNodes: updater => {
      nodesRef.current = updater(nodesRef.current)
    },
    onSpacesChange,
    createNodeForSession,
  } as unknown as RoleRunActionContext)
  expect(onSpacesChange).not.toHaveBeenCalled()
  expect(createNodeForSession).not.toHaveBeenCalled()
  expect(nodesRef.current[0].data.role).toMatchObject({
    input: '',
    runHistory: [],
    linkedAgentNodeId: null,
  })
  expect(nodesRef.current[0].data.lastError).toContain('Rephrase')
})
