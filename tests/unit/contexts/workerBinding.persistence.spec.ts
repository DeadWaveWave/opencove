import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'

function createWorkspace(workerBinding?: {
  endpointId: string
  mountId: string | null
}): WorkspaceState {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/local/repo',
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    environmentVariables: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    nodes: [
      {
        id: 'terminal-1',
        type: 'terminalNode',
        position: { x: 0, y: 0 },
        data: {
          sessionId: 'session-1',
          title: 'Terminal',
          width: 520,
          height: 360,
          kind: 'terminal',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          executionDirectory: '/remote/repo',
          expectedDirectory: '/remote/repo',
          workerBinding: workerBinding ?? null,
          agent: null,
          task: null,
          note: null,
          image: null,
          document: null,
          website: null,
        } as TerminalNodeData,
      },
    ],
  }
}

describe('node worker binding persistence', () => {
  it('round-trips endpoint and mount as node-owned durable truth', () => {
    const persisted = toPersistedState(
      [createWorkspace({ endpointId: 'endpoint-remote', mountId: 'mount-remote' })],
      'workspace-1',
      DEFAULT_AGENT_SETTINGS,
    )

    expect(persisted.workspaces[0]?.nodes[0]?.workerBinding).toEqual({
      endpointId: 'endpoint-remote',
      mountId: 'mount-remote',
    })

    const normalized = normalizePersistedAppState(persisted)
    expect(normalized?.workspaces[0]?.nodes[0]?.workerBinding).toEqual({
      endpointId: 'endpoint-remote',
      mountId: 'mount-remote',
    })
  })

  it('keeps old node data without a worker binding readable', () => {
    const rawWorkspace = toPersistedState(
      [createWorkspace()],
      'workspace-1',
      DEFAULT_AGENT_SETTINGS,
    ).workspaces[0]!
    delete (rawWorkspace.nodes[0] as Record<string, unknown>).workerBinding

    const ensured = ensurePersistedWorkspace(rawWorkspace)

    expect(ensured?.nodes[0]?.workerBinding).toBeNull()
  })
})
