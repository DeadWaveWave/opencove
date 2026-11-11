import { expect, it } from 'vitest'
import { updateWorkspacesWithAgentMetadata } from '@app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync.agentMetadata'
import { applyAgentMetadataToNodes } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
it.each([null, 'A'])(
  'both metadata consumers preserve owned unverified tuple %s without a flush signal',
  resumeSessionId => {
    const workspace = toShellWorkspaceState(
      ensurePersistedWorkspace({
        id: 'p',
        name: 'P',
        path: '/tmp/p',
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
            managedClaudeResumeBindingOwnership: { activationId: 'a', runtimeSessionId: 'runtime' },
            agent: {
              provider: 'claude-code',
              executionDirectory: '/tmp/p',
              resumeSessionId,
              resumeSessionIdVerified: false,
            },
          },
        ],
      })!,
    )
    const event = { sessionId: 'runtime', resumeSessionId: 'B' }
    expect(applyAgentMetadataToNodes(workspace.nodes, event)).toEqual({
      nextNodes: workspace.nodes,
      didChange: false,
    })
    expect(updateWorkspacesWithAgentMetadata({ workspaces: [workspace], ...event })).toEqual({
      nextWorkspaces: [workspace],
      didChange: false,
      durableDidChange: false,
    })
  },
)
