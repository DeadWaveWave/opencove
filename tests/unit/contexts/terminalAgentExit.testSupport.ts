import type { TerminalSessionMetadataEvent } from '../../../src/shared/contracts/dto'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

export function createTerminalAgentWorkspace(
  provider: 'claude-code' | 'codex' = 'codex',
  verified = false,
): WorkspaceState {
  const data: TerminalNodeData = {
    kind: 'terminal',
    sessionId: 'pty-1',
    title: 'Terminal',
    width: 520,
    height: 360,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: 'preserved output',
    executionDirectory: '/tmp/workspace',
    terminalAgentBinding: verified
      ? { provider, resumeSessionId: 'resume-1', resumeSessionIdVerified: true }
      : null,
    agentOverlay: {
      provider,
      status: 'running',
      startedAtMs: 100,
      activity: {
        invocationId: 'invocation-1',
        generation: 1,
        phase: 'active',
        observedAtMs: 100,
      },
    },
    agentRuntimeObservation: {
      status: 'running',
      source: provider === 'codex' ? 'codex_hook' : 'claude_hook',
      hookInstallState: 'installed',
      degraded: false,
    },
    agent: null,
    task: null,
    note: null,
    image: null,
    document: null,
    website: null,
  }
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    worktreesRoot: '',
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: false,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    nodes: [{ id: 'terminal-1', type: 'terminalNode', position: { x: 0, y: 0 }, data }],
  }
}

export function invocationEvent(
  provider: 'claude-code' | 'codex',
  phase: 'active' | 'exited',
  generation = 1,
): TerminalSessionMetadataEvent & {
  terminalAgentActivity: NonNullable<TerminalSessionMetadataEvent['terminalAgentActivity']>
} {
  return {
    sessionId: 'pty-1',
    resumeSessionId: null,
    terminalAgentActivity: {
      provider,
      invocationId: `invocation-${generation}`,
      generation,
      phase,
      observedAtMs: generation * 100 + 50,
      identityAuthority: null,
    },
  }
}
