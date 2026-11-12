export function taskAuthorityState() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: {},
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/repo',
        spaces: [],
        nodes: [
          {
            id: 'task',
            kind: 'task',
            title: 'Task',
            position: { x: 1, y: 2 },
            width: 300,
            height: 200,
            task: { requirement: 'Keep requirement', status: 'todo', tags: ['keep'] },
          },
          {
            id: 'other-task',
            kind: 'task',
            title: 'Other task',
            position: { x: 1, y: 2 },
            width: 300,
            height: 200,
            task: { requirement: 'Other', status: 'todo' },
          },
          {
            id: 'note',
            kind: 'note',
            title: 'Note',
            position: { x: 1, y: 2 },
            width: 300,
            height: 200,
            task: { text: 'Original 🌊' },
          },
          ...['a', 'b'].map(id => ({
            id,
            kind: 'agent',
            title: id,
            sessionId: `session-${id}`,
            position: { x: 1, y: 2 },
            width: 500,
            height: 400,
            agent: { provider: 'codex', executionDirectory: '/repo', taskId: null },
          })),
        ],
      },
    ],
  }
}
