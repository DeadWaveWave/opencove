import { describe, expect, it } from 'vitest'
import { toShellWorkspaceStateForSync } from '../../../src/app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'
import type {
  PersistedWorkspaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

const persistedWorkspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/repo',
  worktreesRoot: '',
  pullRequestBaseBranchOptions: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  isMinimapVisible: true,
  spaces: [],
  activeSpaceId: null,
  spaceArchiveRecords: [],
  nodes: [
    {
      id: 'agent-1',
      title: 'codex',
      position: { x: 0, y: 0 },
      width: 520,
      height: 360,
      kind: 'agent',
      status: 'running',
      startedAt: '2026-08-15T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      executionDirectory: '/repo',
      expectedDirectory: '/repo',
      agent: {
        provider: 'codex',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'resume',
        resumeSessionId: 'thread-1',
        resumeSessionIdVerified: true,
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
      },
    },
  ],
} as PersistedWorkspaceState

describe('worker sync transient recovery state', () => {
  it('does not overwrite a runtime-owned writer-lock issue with durable node state', () => {
    const initial = toShellWorkspaceStateForSync(persistedWorkspace, undefined)
    const existing = {
      ...initial,
      nodes: initial.nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          sessionId: 'fallback-shell',
          status: 'standby' as const,
          recoveryIssue: 'codex_writer_locked' as const,
        },
      })),
    } satisfies WorkspaceState

    const merged = toShellWorkspaceStateForSync(persistedWorkspace, existing)

    expect(merged.nodes[0]?.data.recoveryIssue).toBe('codex_writer_locked')
    expect(merged.nodes[0]?.data.status).toBe('standby')
    expect(merged.nodes[0]?.data.sessionId).toBe('fallback-shell')
  })
})
