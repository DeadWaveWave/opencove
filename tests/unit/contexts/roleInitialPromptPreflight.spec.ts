import { expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  runRoleNodeAction,
  type RoleRunActionContext,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useRoleActions.run'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createStoreBackedChannels } from '../../support/workspaceCanvasStoreHarness'

it.each(['update', 'plugins\0 explain this project'])(
  'refused role preserves input and history before mount resolution or launch (%j)',
  async prompt => {
    const { nodesRef, readDocument, setNodes } = createStoreBackedChannels({
      workspaceId: 'workspace',
      nodes: [
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
    })
    const updateCanvasDocument = vi.fn()
    const updateSpaces = vi.fn()
    const createNodeForSession = vi.fn()
    await runRoleNodeAction('role', undefined, {
      readDocument,
      agentSettings: DEFAULT_AGENT_SETTINGS,
      projectRoles: [{ id: 'definition', promptTemplate: prompt }],
      updateNodes: setNodes,
      updateCanvasDocument,
      updateSpaces,
      createNodeForSession,
    } as unknown as RoleRunActionContext)
    expect(updateCanvasDocument).not.toHaveBeenCalled()
    expect(updateSpaces).not.toHaveBeenCalled()
    expect(createNodeForSession).not.toHaveBeenCalled()
    expect(nodesRef.current[0].data.role).toMatchObject({
      input: '',
      runHistory: [],
      linkedAgentNodeId: null,
    })
    expect(nodesRef.current[0].data.lastError).toMatch(/Rephrase|null character/u)
  },
)
