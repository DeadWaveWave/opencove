import { describe, expect, it } from 'vitest'
import { updateWorkspacesWithTerminalGeometry } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

function createWorkspace(): WorkspaceState[] {
  return [
    {
      nodes: [
        {
          id: 'agent-a',
          data: {
            kind: 'agent',
            sessionId: 'session-a',
            terminalGeometry: { cols: 80, rows: 24 },
          },
        },
        {
          id: 'terminal-b',
          data: {
            kind: 'terminal',
            sessionId: 'session-b',
            terminalGeometry: { cols: 80, rows: 24 },
          },
        },
      ],
    },
  ] as WorkspaceState[]
}

describe('PTY workspace runtime geometry sync', () => {
  it('persists terminal geometry changes by session without touching unrelated nodes', () => {
    const workspaces = createWorkspace()
    const result = updateWorkspacesWithTerminalGeometry({
      workspaces,
      sessionId: 'session-a',
      cols: 64,
      rows: 44,
    })

    expect(result.didChange).toBe(true)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.terminalGeometry).toEqual({
      cols: 64,
      rows: 44,
    })
    expect(result.nextWorkspaces[0]?.nodes[1]).toBe(workspaces[0]?.nodes[1])

    const noOp = updateWorkspacesWithTerminalGeometry({
      workspaces: result.nextWorkspaces,
      sessionId: 'session-a',
      cols: 64,
      rows: 44,
    })
    expect(noOp.didChange).toBe(false)
    expect(noOp.nextWorkspaces).toEqual(result.nextWorkspaces)
  })
})
