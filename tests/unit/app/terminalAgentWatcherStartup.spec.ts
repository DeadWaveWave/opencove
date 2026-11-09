import { expect, it, vi } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { createTerminalAgentWatcherOwner } from '../../../src/app/renderer/shell/utils/terminalAgentWatcherOwner'
import { updateWorkspacesWithTerminalAgentActivityMetadata } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync.terminalAgentActivity'
import { createTerminalAgentWorkspace } from '../contexts/terminalAgentExit.testSupport'
import { resolveTerminalAgentInvocationArguments } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentInvocationArguments'

it.each([
  ['codex', ['resume', '--last'], 'resume', null],
  ['codex', ['--model', 'model', 'resume', 'saved'], 'resume', 'saved'],
  ['codex', ['--', 'resume'], 'new', null],
  ['claude-code', ['--continue'], 'resume', null],
  ['claude-code', ['--resume=saved'], 'resume', 'saved'],
  ['claude-code', ['--', '--resume=saved'], 'new', null],
] as const)(
  'keeps %s invocation intent distinct from identity for %j',
  (provider, args, launchMode, expectedResumeSessionId) => {
    expect(resolveTerminalAgentInvocationArguments(provider, args)).toEqual({
      launchMode,
      expectedResumeSessionId,
    })
  },
)

it.each(['new', 'resume'] as const)(
  'keeps the %s invocation intent when provider identity becomes verified',
  async launchMode => {
    const registry = new TerminalAgentInvocationRegistry({ now: () => 100 })
    const invoke = vi.fn(async () => undefined)
    const owner = createTerminalAgentWatcherOwner({ invoke })
    let workspaces = [createTerminalAgentWorkspace('codex')]
    workspaces[0].nodes[0].data.agentOverlay = null
    const unsubscribe = registry.onMetadata(event => {
      workspaces = updateWorkspacesWithTerminalAgentActivityMetadata({
        workspaces,
        event: event as never,
      }).nextWorkspaces
      owner.sync(workspaces)
    })
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty-1')
    const invocation = terminal.beginInvocation({
      provider: 'codex',
      invocationId: 'invocation-1',
      launchMode,
      expectedResumeSessionId: launchMode === 'resume' ? 'saved' : null,
    })!
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    invocation.observe({
      identityAuthority: 'provider_session_start',
      resumeSessionId: 'saved',
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(invoke).toHaveBeenCalledTimes(launchMode === 'new' ? 1 : 3)
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ launchMode }) }),
    )
    unsubscribe()
    owner.dispose()
    terminal.release()
  },
)

it.each([
  ['claude-code', 'new'],
  ['codex', 'new'],
  ['claude-code', 'resume'],
  ['codex', 'resume'],
] as const)(
  'does not use the previous Claude binding for a %s %s invocation',
  async (provider, launchMode) => {
    const registry = new TerminalAgentInvocationRegistry({ now: () => 200 })
    const invoke = vi.fn(async () => undefined)
    const owner = createTerminalAgentWatcherOwner({ invoke })
    let workspaces = [createTerminalAgentWorkspace('claude-code', true)]
    workspaces[0].nodes[0].data.agentOverlay = null
    const unsubscribe = registry.onMetadata(event => {
      workspaces = updateWorkspacesWithTerminalAgentActivityMetadata({
        workspaces,
        event: event as never,
      }).nextWorkspaces
      owner.sync(workspaces)
    })
    const terminal = registry.reserve({ sourceId: 'terminal-shim' })
    terminal.bind('pty-1')
    const invocation = terminal.beginInvocation({
      provider,
      invocationId: 'invocation-2',
      launchMode,
      expectedResumeSessionId: launchMode === 'resume' ? 'current-session' : null,
    })!
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ provider, launchMode, resumeSessionId: null }),
      }),
    )
    expect(workspaces[0].nodes[0].data.terminalAgentBinding?.resumeSessionId).toBe('resume-1')
    invocation.observe({
      identityAuthority: 'provider_session_start',
      resumeSessionId: 'current-session',
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(invoke).toHaveBeenCalledTimes(launchMode === 'new' ? 1 : 3)
    if (launchMode === 'resume') {
      expect(invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ resumeSessionId: 'current-session' }),
        }),
      )
    }
    unsubscribe()
    owner.dispose()
    terminal.release()
  },
)
