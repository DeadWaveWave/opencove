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
import { runTaskAgentAction } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.run'
import type { TaskActionContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.shared'
import { translate } from '../../../src/app/renderer/i18n'
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

interface RelaunchCase {
  status: string
  mode: 'new' | 'resume'
  action: string
  competing: boolean
  directoryMode?: 'workspace' | 'custom'
  blank?: boolean
  phase?: 'identity' | 'spawn'
}

describeWithElectronNativeModules('UI Claude relaunch during normal persistence', () => {
  it.each<RelaunchCase>([
    ...['standby', 'stopped'].flatMap(status =>
      (['resume', 'new'] as const).map(mode => ({
        status,
        mode,
        action: 'direct',
        competing: false,
      })),
    ),
    ...['standby', 'stopped'].map(status => ({
      status,
      mode: 'new' as const,
      action: 'task-reuse',
      competing: false,
    })),
    { status: 'standby', mode: 'new' as const, action: 'task-reuse', competing: true },
    ...(['workspace', 'custom'] as const).flatMap(directoryMode =>
      [false, true].map(blank => ({
        status: 'standby',
        mode: 'new' as const,
        action: 'task-reuse',
        competing: false,
        directoryMode,
        blank,
        phase: 'identity' as const,
      })),
    ),
  ])(
    '$action $mode from $status preserves its snapshot ($phase/$directoryMode/blank=$blank/competing=$competing)',
    async ({ status, mode, action, competing, directoryMode, blank, phase = 'spawn' }) => {
      const entered = deferred<void>(),
        release = deferred<void>()
      f = await snapshotFixture(':memory:', null, false, 'launch', false, false, {
        beforeIdentity: async () => {
          if (phase === 'identity') {
            entered.resolve()
            await release.promise
          }
        },
      })
      const fixture = f
      fixture.state.workspaces[0].nodes[0].status = status
      const originalAgent = fixture.state.workspaces[0].nodes[0].agent!
      if (directoryMode) {
        originalAgent.directoryMode = directoryMode
        // The task has moved to a Space outside the agent's stored directory.
        fixture.state.workspaces[0].spaces = [
          {
            id: 'task-space',
            name: 'Moved task',
            directoryPath: '/moved-task',
            nodeIds: ['task'],
          },
        ] as (typeof fixture.state.workspaces)[0]['spaces']
      }
      if (blank) {
        Object.assign(originalAgent, {
          prompt: '',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
        })
      }
      const initialState = normalizePersistedAppState({
        ...fixture.state,
        workspaces: fixture.state.workspaces.map(workspace => ({
          ...workspace,
          nodes: [
            ...workspace.nodes,
            ...(action === 'task-reuse'
              ? [
                  {
                    id: 'task',
                    kind: 'task',
                    title: 'Next task',
                    position: { x: 0, y: 500 },
                    width: 400,
                    height: 300,
                    task: {
                      requirement: 'Next requirement',
                      status: 'todo',
                      linkedAgentNodeId: 'agent',
                    },
                  },
                ]
              : []),
          ],
        })),
      })!
      await fixture.store.writeAppState(initialState)
      const snapshot = fixture.store.observeManagedClaudeNode('agent').adoptionSnapshot
      const workspace = toShellWorkspaceState(
        initialState.workspaces[0] as unknown as PersistedWorkspaceState,
      )
      const spawn = fixture.spawn.getMockImplementation()!
      fixture.spawn.mockImplementation(async input => {
        const result = await spawn(input)
        if (phase === 'spawn') {
          entered.resolve()
          await release.promise
        }
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
        const [spaces, setSpaces] = useState(workspace.spaces)
        const spacesRef = useRef(spaces)
        spacesRef.current = spaces
        const onSpacesChange = (next: typeof spaces) => {
          spacesRef.current = next
          setSpaces(next)
        }
        const workspaces = useMemo(() => [{ ...workspace, nodes, spaces }], [nodes, spaces])
        const produce = useCallback(
          () =>
            toPersistedState(
              [{ ...workspace, nodes: nodesRef.current, spaces: spacesRef.current }],
              workspace.id,
            ),
          [],
        )
        const persistence = usePersistedAppState({
          workspaces,
          activeWorkspaceId: workspace.id,
          agentSettings: DEFAULT_AGENT_SETTINGS,
          isHydrated: true,
          producePersistedState: produce,
        })
        const setCanvasNodes: TaskActionContext['setNodes'] = update => {
          const next = update(nodesRef.current)
          nodesRef.current = next
          setNodes(next)
        }
        const lifecycle = useWorkspaceCanvasAgentNodeLifecycle({
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          nodesRef,
          spacesRef,
          onSpacesChange,
          setNodes: setCanvasNodes,
          bumpAgentLaunchToken: () => 1,
          isAgentLaunchTokenCurrent: () => true,
          agentFullAccess: false,
          codexReuseRunningAppServer: false,
          defaultTerminalProfileId: null,
          terminalFontSize: 13,
          terminalDisplayMetrics: { fontSize: 13 },
          agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
        })
        return {
          ...lifecycle,
          nodesRef,
          runTask: () =>
            runTaskAgentAction('task', {
              nodesRef,
              spacesRef,
              onSpacesChange,
              setNodes: setCanvasNodes,
              createNodeForSession: vi.fn(),
              buildAgentNodeTitle: () => 'Claude',
              launchAgentInNode: lifecycle.launchAgentInNode,
              agentSettings: DEFAULT_AGENT_SETTINGS,
              workspaceId: workspace.id,
              workspacePath: workspace.path,
              terminalDisplayMetrics: { fontSize: 13 },
              t: translate,
              onRequestPersistFlush: persistence.requestPersistFlush,
            }),
        }
      })
      let launch!: ReturnType<typeof hook.result.current.launchAgentInNode>
      try {
        await act(async () => {
          launch =
            action === 'task-reuse'
              ? hook.result.current.runTask()
              : hook.result.current.launchAgentInNode('agent', mode)
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
        const prepared = normalizePersistedAppState(await fixture.store.readAppState())!
        expect(prepared.workspaces[0].nodes[0].agent).toMatchObject({
          resumeSessionId: blank ? null : 'initial-conversation',
          resumeSessionIdVerified: !blank,
          prompt: originalAgent.prompt,
          executionDirectory: '/repo/project',
        })
        expect(fixture.store.observeManagedClaudeNode('agent').adoptionSnapshot).toBe(snapshot)
        if (competing) {
          Object.assign(prepared.workspaces[0].nodes[0].agent!, {
            resumeSessionId: 'competing-B',
            resumeSessionIdVerified: true,
          })
          await fixture.store.writeAppState(prepared)
        }
        await act(async () => {
          release.resolve()
          await launch
        })
        const binding = fixture.store.observeManagedClaudeNode('agent').binding
        if (competing) {
          expect(binding).toBeNull()
          expect(fixture.alive.size).toBe(0)
          expect(
            normalizePersistedAppState(await fixture.store.readAppState())!.workspaces[0].nodes[0]
              .agent!.resumeSessionId,
          ).toBe('competing-B')
          expect(hook.result.current.nodesRef.current[0].data.lastError).toContain('changed')
          return
        }
        const target = mode === 'resume' ? 'initial-conversation' : 'new-conversation'
        const current = hook.result.current.nodesRef.current[0].data
        if (directoryMode === 'workspace') {
          // Changed-directory unowned launches retain the established legacy boundary.
          expect(binding).toBeNull()
        } else {
          expect(binding).toMatchObject({
            tuple: { resumeSessionId: target, resumeSessionIdVerified: true },
          })
          expect(current.sessionId).toBe(binding!.runtimeSessionId)
        }
        expect(fixture.alive.has(current.sessionId)).toBe(true)
        if (action === 'task-reuse') {
          expect(fixture.launch).toHaveBeenCalledWith(
            expect.objectContaining({
              cwd: directoryMode === 'workspace' ? '/moved-task' : '/repo/project',
              prompt: 'Next requirement',
            }),
          )
        }
        expect(hook.result.current.nodesRef.current[0].data).toMatchObject({
          lastError: null,
          agent: {
            resumeSessionId: target,
            resumeSessionIdVerified: true,
            prompt: action === 'task-reuse' ? 'Next requirement' : originalAgent.prompt,
            executionDirectory: directoryMode === 'workspace' ? '/moved-task' : '/repo/project',
          },
        })
      } finally {
        await act(async () => {
          release.resolve()
          await launch
        })
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
