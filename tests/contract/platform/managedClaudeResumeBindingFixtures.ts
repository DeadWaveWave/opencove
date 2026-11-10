export const tupleA = { resumeSessionId: 'A', resumeSessionIdVerified: true }
export const tupleB = { resumeSessionId: 'B', resumeSessionIdVerified: true }
export function stateWithAgent() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: { theme: 'dark' },
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/repo',
        nodes: [
          {
            id: 'agent',
            kind: 'agent',
            sessionId: 'old',
            title: 'Claude',
            position: { x: 1, y: 2 },
            width: 500,
            height: 400,
            agent: { provider: 'claude-code', model: 'old', ...tupleA },
          },
        ],
        spaces: [],
      },
    ],
  }
}
