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
