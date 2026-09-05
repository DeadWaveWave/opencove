import { describe, expect, it } from 'vitest'
import { updateWorkspacesWithAgentRunState } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import { updateWorkspacesWithTerminalAgentActivityMetadata } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync.terminalAgentActivity'
import { createTerminalAgentWorkspace, invocationEvent } from './terminalAgentExit.testSupport'

describe.each(['codex', 'claude-code'] as const)('%s terminal Agent exit lifecycle', provider => {
  it.each([false, true])(
    'invalidates old work without destroying binding or exit fence (verified=%s)',
    verified => {
      const workspace = createTerminalAgentWorkspace(provider, verified)
      const exited = updateWorkspacesWithTerminalAgentActivityMetadata({
        workspaces: [workspace],
        event: invocationEvent(provider, 'exited'),
      })
      expect(exited.durableDidChange).toBe(false)
      expect(exited.nextWorkspaces[0].nodes[0].data.agentRuntimeObservation).toBeNull()
      expect(exited.nextWorkspaces[0].nodes[0].data.terminalAgentBinding).toEqual(
        workspace.nodes[0].data.terminalAgentBinding,
      )

      for (const source of ['session_file', 'claude_hook', 'codex_hook'] as const) {
        const late = updateWorkspacesWithAgentRunState({
          workspaces: exited.nextWorkspaces,
          sessionId: 'pty-1',
          state: 'working',
          source,
        })
        expect(late.didChange).toBe(false)
        expect(late.nextWorkspaces[0]).toBe(exited.nextWorkspaces[0])
      }
      const replay = updateWorkspacesWithTerminalAgentActivityMetadata({
        workspaces: exited.nextWorkspaces,
        event: invocationEvent(provider, 'active'),
      })
      expect(replay.didChange).toBe(false)
      expect(replay.nextWorkspaces[0].nodes[0].data.agentOverlay?.activity?.phase).toBe('exited')
    },
  )

  it('accepts task cancellation as standby without changing the active invocation', () => {
    const workspace = createTerminalAgentWorkspace(provider, true)
    const cancelled = updateWorkspacesWithAgentRunState({
      workspaces: [workspace],
      sessionId: 'pty-1',
      state: 'standby',
    })
    expect(cancelled.durableDidChange).toBe(false)
    expect(cancelled.nextWorkspaces[0].nodes[0].data).toMatchObject({
      agentOverlay: { status: 'standby', activity: { phase: 'active' } },
      agentRuntimeObservation: { status: 'standby' },
      terminalAgentBinding: workspace.nodes[0].data.terminalAgentBinding,
    })
  })

  it('does not inherit work when a new generation supersedes an active invocation', () => {
    const result = updateWorkspacesWithTerminalAgentActivityMetadata({
      workspaces: [createTerminalAgentWorkspace(provider, true)],
      event: invocationEvent(provider, 'active', 2),
    })
    expect(result.nextWorkspaces[0].nodes[0].data.agentRuntimeObservation).toBeNull()
    const working = updateWorkspacesWithAgentRunState({
      workspaces: result.nextWorkspaces,
      sessionId: 'pty-1',
      state: 'working',
    })
    expect(working.nextWorkspaces[0].nodes[0].data.agentRuntimeObservation?.status).toBe('running')
    expect(working.nextWorkspaces[0].nodes[0].data.agentOverlay?.activity?.generation).toBe(2)
  })
})
