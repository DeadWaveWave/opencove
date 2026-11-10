import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'
import {
  prepareWorkspaceRuntimeNodes,
  toShellWorkspaceState,
} from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import { normalizeAgentSettings } from '../../../src/contexts/settings/domain/agentSettings'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  markPersistedStateAsSynced,
  writePersistedState,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/write'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import type {
  PersistedWorkspaceState,
  PersistedAppState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import type { ManagedClaudeLifecycleReceipt } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { PreparedRuntimeNodeResult } from '../../../src/shared/contracts/dto'
import type { Operation, SnapshotFixture } from './managedClaudeSnapshotFixture'

export async function rendererSnapshot(f: SnapshotFixture, operation: Operation) {
  const workspace = toShellWorkspaceState(
    f.state.workspaces[0] as unknown as PersistedWorkspaceState,
  )
  const settings = normalizeAgentSettings(f.state.settings)
  const nodesRef = { current: workspace.nodes }
  if (operation.startsWith('prepare')) {
    nodesRef.current = await prepareWorkspaceRuntimeNodes({
      workspace: f.state.workspaces[0] as unknown as PersistedWorkspaceState,
      agentSettings: settings,
      workerOnly: true,
    })
  } else {
    const hook = renderHook(() =>
      useWorkspaceCanvasAgentNodeLifecycle({
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        nodesRef,
        spacesRef: { current: workspace.spaces },
        onSpacesChange: vi.fn(),
        setNodes: update => {
          nodesRef.current = update(nodesRef.current)
        },
        bumpAgentLaunchToken: () => 1,
        isAgentLaunchTokenCurrent: () => true,
        agentFullAccess: false,
        codexReuseRunningAppServer: false,
        defaultTerminalProfileId: null,
        terminalFontSize: 13,
        terminalDisplayMetrics: { fontSize: 13 },
        agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
      }),
    )
    try {
      await act(async () => {
        if (operation === 'switch') {
          await hook.result.current.switchAgentNodeSession('agent', {
            provider: 'claude-code',
            sessionId: 'selected-conversation',
            cwd: '/repo/project',
          } as never)
        } else {
          await hook.result.current.launchAgentInNode(
            'agent',
            operation === 'launch' ? 'resume' : 'new',
          )
        }
      })
    } finally {
      hook.unmount()
    }
  }
  const binding = f.store.observeManagedClaudeNode('agent').binding
  const response = f.results.at(-1)!.value as {
    managedClaudeLifecycle?: ManagedClaudeLifecycleReceipt
    nodes?: PreparedRuntimeNodeResult[]
  }
  const prepared = response.nodes?.[0]
  const receipt = prepared?.managedClaudeLifecycle ?? response.managedClaudeLifecycle
  // A real local edit prevents the renderer's publication cache from skipping this write.
  const snapshot = toPersistedState(
    [{ ...workspace, name: `${operation} snapshot`, nodes: nodesRef.current }],
    workspace.id,
    settings,
  )
  return { snapshot, nodes: nodesRef.current, binding, receipt, prepared }
}

export async function persistRendererSnapshot(f: SnapshotFixture, snapshot: PersistedAppState) {
  const base = normalizePersistedAppState(await f.store.readAppState())!
  markPersistedStateAsSynced(
    base as unknown as PersistedAppState,
    await f.store.readAppStateRevision(),
  )
  return writePersistedState(snapshot)
}
