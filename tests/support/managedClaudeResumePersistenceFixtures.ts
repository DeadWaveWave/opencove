import { DEFAULT_AGENT_SETTINGS } from '../../src/contexts/settings/domain/agentSettings'

export function managedClaudeResumeState() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: DEFAULT_AGENT_SETTINGS,
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/repo',
        worktreesRoot: '/worktrees',
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        activeSpaceId: null,
        spaceArchiveRecords: [],
        spaces: [],
        nodes: [
          {
            id: 'agent',
            kind: 'agent',
            title: 'Claude',
            sessionId: 'runtime',
            position: { x: 0, y: 0 },
            width: 500,
            height: 400,
            workerBinding: { endpointId: 'local', mountId: null },
            agent: {
              provider: 'claude-code',
              executionDirectory: '/repo',
              resumeSessionId: 'A',
              resumeSessionIdVerified: true,
            },
          },
        ],
      },
    ],
  }
}

export const rejectedManagedClaudeAgents = [
  { label: 'array agent', agent: [], field: 'agent', rebasable: false },
  {
    label: 'invalid provider',
    agent: { provider: 'invalid-provider', executionDirectory: '/repo' },
    field: 'agent.provider',
    rebasable: false,
  },
  {
    label: 'different supported provider',
    agent: { provider: 'codex', executionDirectory: '/repo' },
    field: 'agent.provider',
    rebasable: true,
  },
] as const
