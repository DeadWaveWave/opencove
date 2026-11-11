// @vitest-environment happy-dom
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import { useCallback, useMemo, useRef, useState } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { snapshotFixture, type SnapshotFixture } from './managedClaudeSnapshotFixture'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { usePersistedAppState } from '../../../src/app/renderer/shell/hooks/usePersistedAppState'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { flushScheduledPersistedStateWriteAsync } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/schedule'
import { markPersistedStateAsSynced } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/write'
import type { PersistedWorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { deferred } from '../../unit/contexts/managedClaudeLaunchCompatibility.helpers'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
const originalApi = window.opencoveApi
let f: SnapshotFixture | undefined
afterEach(async () => {
  cleanup()
  await flushScheduledPersistedStateWriteAsync()
  f?.dispose()
  f = undefined
  window.opencoveApi = originalApi
  vi.useRealTimers()
})

describeWithElectronNativeModules('UI Claude relaunch during normal persistence', () => {
  it.each(
    ['standby', 'stopped'].flatMap(status =>
      (['resume', 'new'] as const).map(mode => ({ status, mode })),
    ),
  )(
    'adopts the requested $mode conversation after the initiating $status-to-restoring save commits during delayed spawn',
    async ({ status, mode }) => {
      f = await snapshotFixture(':memory:', null, false, 'launch')
      const fixture = f
      fixture.state.workspaces[0].nodes[0].status = status
      await fixture.store.writeAppState(fixture.state)
      const workspace = toShellWorkspaceState(
        fixture.state.workspaces[0] as unknown as PersistedWorkspaceState,
      )
      const entered = deferred<void>(),
        release = deferred<void>()
      const spawn = fixture.spawn.getMockImplementation()!
      fixture.spawn.mockImplementation(async input => {
        const result = await spawn(input)
        entered.resolve()
        await release.promise
        return result
      })
      const write = vi.fn(
        async ({ state, baseRevision }: { state: unknown; baseRevision?: number | null }) =>
          fixture.store.writeAppState(state, { baseRevision: baseRevision ?? undefined }),
      )
      window.opencoveApi = {
        meta: { isTest: true },
        controlSurface: { invoke: fixture.invoke },
        agent: { launch: fixture.launch },
        pty: { kill: vi.fn(async () => {}) },
        persistence: {
          readAppState: async () => fixture.store.readAppStateSnapshot!(),
          writeAppState: write,
        },
      } as unknown as typeof window.opencoveApi
      markPersistedStateAsSynced(
        toPersistedState([workspace], workspace.id),
        await fixture.store.readAppStateRevision(),
      )
      vi.useFakeTimers()
      const hook = renderHook(() => {
        const [nodes, setNodes] = useState(workspace.nodes)
        const nodesRef = useRef(nodes)
        nodesRef.current = nodes
        const workspaces = useMemo(() => [{ ...workspace, nodes }], [nodes])
        const produce = useCallback(
          () => toPersistedState([{ ...workspace, nodes: nodesRef.current }], workspace.id),
          [],
        )
        usePersistedAppState({
          workspaces,
          activeWorkspaceId: workspace.id,
          agentSettings: DEFAULT_AGENT_SETTINGS,
          isHydrated: true,
          producePersistedState: produce,
        })
        const lifecycle = useWorkspaceCanvasAgentNodeLifecycle({
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          nodesRef,
          spacesRef: { current: workspace.spaces },
          onSpacesChange: vi.fn(),
          setNodes: update => {
            const next = update(nodesRef.current)
            nodesRef.current = next
            setNodes(next)
          },
          bumpAgentLaunchToken: () => 1,
          isAgentLaunchTokenCurrent: () => true,
          agentFullAccess: false,
          codexReuseRunningAppServer: false,
          defaultTerminalProfileId: null,
          terminalFontSize: 13,
          terminalDisplayMetrics: { fontSize: 13 },
          agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
        })
        return { ...lifecycle, nodesRef }
      })
      let launch!: ReturnType<typeof hook.result.current.launchAgentInNode>
      try {
        await act(async () => {
          launch = hook.result.current.launchAgentInNode('agent', mode)
          await entered.promise
        })
        // Exercise the actual scheduler's debounce, not an explicit persist flush.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000)
        })
        expect(write).toHaveBeenCalled()
        expect(
          normalizePersistedAppState(await fixture.store.readAppState())!.workspaces[0].nodes[0]
            .status,
        ).toBe('restoring')
        expect(fixture.store.observeManagedClaudeNode('agent').binding).toBeNull()
        await act(async () => {
          release.resolve()
          await launch
        })
        const binding = fixture.store.observeManagedClaudeNode('agent').binding
        const target = mode === 'resume' ? 'initial-conversation' : 'new-conversation'
        expect(binding).toMatchObject({
          tuple: { resumeSessionId: target, resumeSessionIdVerified: true },
        })
        expect(fixture.alive.has(binding!.runtimeSessionId!)).toBe(true)
        expect(hook.result.current.nodesRef.current[0].data).toMatchObject({
          sessionId: binding!.runtimeSessionId,
          lastError: null,
          agent: { resumeSessionId: target, resumeSessionIdVerified: true },
        })
      } finally {
        release.resolve()
        await launch
        hook.unmount()
      }
    },
  )
})

describeWithElectronNativeModules('cold Claude adoption cancellation', () => {
  it('keeps a competing Stop authoritative at activation after cold spawn', async () => {
    f = await snapshotFixture(':memory:', null, false, 'prepareResume')
    const fixture = f
    const entered = deferred<void>(),
      release = deferred<void>()
    const spawn = fixture.spawn.getMockImplementation()!
    fixture.spawn.mockImplementation(async input => {
      const result = await spawn(input)
      entered.resolve()
      await release.promise
      return result
    })
    const preparing = fixture.invoke({
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'project', nodeIds: ['agent'] },
    })
    try {
      await entered.promise
      fixture.state.workspaces[0].nodes[0].status = 'stopped'
      await fixture.store.writeAppState(fixture.state)
      release.resolve()
      await expect(preparing).rejects.toMatchObject({ details: { reason: 'superseded' } })
      expect(fixture.store.observeManagedClaudeNode('agent').binding).toBeNull()
      expect(fixture.alive.size).toBe(0)
    } finally {
      release.resolve()
      await preparing.catch(() => {})
    }
  })
})
