// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { snapshotFixture, type SnapshotFixture } from './managedClaudeSnapshotFixture'
import { deferred } from '../../unit/contexts/managedClaudeLaunchCompatibility.helpers'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'

const eventMutation = vi.hoisted(() => ({ omitDisplacement: false }))
vi.mock(
  '../../../src/platform/persistence/sqlite/appStateCommitObservation',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../src/platform/persistence/sqlite/appStateCommitObservation')
      >()
    return {
      ...actual,
      createAppStateCommitObservation: (
        ...args: Parameters<typeof actual.createAppStateCommitObservation>
      ) => {
        const observer = actual.createAppStateCommitObservation(...args)
        return {
          ...observer,
          describe: (...input: Parameters<typeof observer.describe>) => {
            const event = observer.describe(...input)
            return eventMutation.omitDisplacement && event?.removedNodeIds.length === 0
              ? null
              : event
          },
        }
      },
    }
  },
)

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
vi.mock('../../../src/platform/terminal/TerminalProfileResolver', () => ({
  TerminalProfileResolver: class {
    async resolveTerminalSpawn(input: { cwd: string }) {
      return {
        cwd: input.cwd,
        command: '/bin/sh',
        args: [],
        env: {},
        profileId: null,
        runtimeKind: 'posix',
      }
    }
  },
}))
describeWithElectronNativeModules('managed Claude fallback shell custody', () => {
  let root: string, f: SnapshotFixture
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-fallback-custody-'))
  })
  afterEach(async () => {
    eventMutation.omitDisplacement = false
    f?.dispose()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  const routes = [null, { endpointId: 'local', mountId: 'mount' }] as const
  async function setup(
    route: (typeof routes)[number],
    activity?: NonNullable<Parameters<typeof snapshotFixture>[6]>['terminalAgentActivity'],
  ) {
    f = await snapshotFixture(
      join(root, 'state.db'),
      route,
      true,
      'prepareStoppedFallback',
      false,
      false,
      { terminalAgentActivity: activity },
    )
  }
  const prepare = () =>
    f.invoke<{ nodes: { sessionId: string }[] }>({
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'project', nodeIds: ['agent'] },
    })
  it('detects a commit observer mutation that drops persistence handoff events', async () => {
    eventMutation.omitDisplacement = true
    await setup(null)
    const first = (await prepare()).nodes[0].sessionId
    const state = normalizePersistedAppState(await f.store.readAppState())!
    state.workspaces[0].nodes[0].sessionId = first
    await f.store.writeAppState(state)
    f.inactive.add(first)
    const second = (await prepare()).nodes[0].sessionId
    state.workspaces[0].nodes[0].sessionId = second
    await f.store.writeAppState(state)
    await expect(
      vi.waitFor(() => expect([...f.alive]).toEqual([second]), { timeout: 50, interval: 5 }),
    ).rejects.toThrow()
    expect(f.alive.has(first)).toBe(true)
    expect(new Set(f.runtime.owner.pendingCleanupRuntimeIds())).toEqual(new Set([first, second]))
  })
  async function remove() {
    const state = normalizePersistedAppState(await f.store.readAppState())!
    state.workspaces[0].nodes = []
    await f.store.writeAppState(state)
  }
  it.each(routes)(
    'keeps both returned shells until the newer fallback is durably handed off, route=%j',
    async route => {
      await setup(route)
      const first = (await prepare()).nodes[0].sessionId
      const second = (await prepare()).nodes[0].sessionId
      expect(new Set(f.alive)).toEqual(new Set([first, second]))
      expect(new Set(f.runtime.owner.pendingCleanupRuntimeIds())).toEqual(new Set([first, second]))
      const state = normalizePersistedAppState(await f.store.readAppState())!
      state.workspaces[0].nodes[0].sessionId = second
      await f.store.writeAppState(state)
      await vi.waitFor(() => expect([...f.alive]).toEqual([second]))
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
    },
  )
  it.each(routes)(
    'retains flag-off unowned shell behavior through activity preparation, route=%j',
    async route => {
      const entered = deferred<void>(),
        release = deferred<void>()
      f = await snapshotFixture(
        join(root, 'state.db'),
        route,
        false,
        'prepareStoppedFallback',
        false,
        false,
        {
          adoptionEnabled: false,
          terminalAgentActivity: {
            prepare: async (input: object) => {
              entered.resolve()
              await release.promise
              return { ...input, commit: () => {}, dispose: () => {} }
            },
          } as never,
        },
      )
      const result = prepare()
      await entered.promise
      f.runtime.owner.reserve('agent')
      release.resolve()
      const shell = (await result).nodes[0].sessionId
      expect(f.spawn).toHaveBeenCalledTimes(1)
      expect(f.alive.has(shell)).toBe(true)
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
      expect(f.store.observeManagedClaudeNode('agent').binding).toBeNull()
    },
  )
  it.each(routes)(
    'cleans an unpersisted successful shell on committed deletion, route=%j',
    async route => {
      await setup(route)
      const result = await prepare()
      const shell = result.nodes[0].sessionId
      expect(f.alive.has(shell)).toBe(true)
      expect(f.store.observeManagedClaudeNode('agent').nodeRuntimeSessionId).toBeNull()
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toContain(shell)
      await remove()
      await vi.waitFor(() => expect(f.alive.has(shell)).toBe(false))
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
    },
  )
  it.each(routes)(
    'hands custody to a persisted reference before deletion, route=%j',
    async route => {
      await setup(route)
      const result = await prepare()
      const shell = result.nodes[0].sessionId
      const state = normalizePersistedAppState(await f.store.readAppState())!
      state.workspaces[0].nodes[0].sessionId = shell
      await f.store.writeAppState(state)
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
      expect(f.alive.has(shell)).toBe(true)
      await remove()
      await vi.waitFor(() => expect(f.alive.has(shell)).toBe(false))
    },
  )
  it.each(routes)(
    'cleans the unpersisted shell after a committed replacement, route=%j',
    async route => {
      await setup(route)
      const shell = (await prepare()).nodes[0].sessionId
      const replacement = await f.invoke<{ sessionId: string }>({
        kind: 'command',
        id: route ? 'session.launchAgentInMount' : 'session.launchAgent',
        payload: {
          canvasNodeId: 'agent',
          workspaceId: 'project',
          cwd: '/repo/project',
          ...(route ? { mountId: 'mount', cwdUri: 'file:///repo/project' } : {}),
          provider: 'claude-code',
          prompt: 'fixture',
          intent: { kind: 'resumeCurrent' },
        },
      })
      expect([...f.alive]).toEqual([replacement.sessionId])
      expect(f.alive.has(shell)).toBe(false)
      expect(f.store.observeManagedClaudeNode('agent').binding?.runtimeSessionId).toBe(
        replacement.sessionId,
      )
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
    },
  )
  it.each(routes)(
    'cleans a persisted shell displaced by another fallback snapshot, route=%j',
    async route => {
      await setup(route)
      const first = (await prepare()).nodes[0].sessionId
      async function persistShell(sessionId: string) {
        const state = normalizePersistedAppState(await f.store.readAppState())!
        state.workspaces[0].nodes[0].sessionId = sessionId
        await f.store.writeAppState(state)
      }
      await persistShell(first)
      // A missing stream registration cannot prove the physical process has stopped.
      f.inactive.add(first)
      const second = (await prepare()).nodes[0].sessionId
      expect(second).not.toBe(first)
      expect(f.alive.has(first)).toBe(true)
      await persistShell(second)
      await vi.waitFor(() => expect([...f.alive]).toEqual([second]))
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
    },
  )
  it.each(
    routes.flatMap(route =>
      ['profile', 'activity'].flatMap(gap =>
        ['newer', 'delete'].map(event => ({ route, gap, event })),
      ),
    ),
  )('fences $event during $gap before shell spawn, route=$route', async ({ route, gap, event }) => {
    const entered = deferred<void>(),
      release = deferred<void>()
    const dispose = vi.fn()
    const activity = {
      prepare: async (input: { command: string; args: string[]; environment: object }) => {
        if (gap === 'activity') {
          entered.resolve()
          await release.promise
        }
        return { ...input, commit: vi.fn(), dispose }
      },
    } as unknown as NonNullable<Parameters<typeof snapshotFixture>[6]>['terminalAgentActivity']
    await setup(route, activity)
    if (gap === 'profile') {
      const original = TerminalProfileResolver.prototype.resolveTerminalSpawn
      vi.spyOn(TerminalProfileResolver.prototype, 'resolveTerminalSpawn').mockImplementation(
        async function (input) {
          entered.resolve()
          await release.promise
          return original.call(this, input)
        },
      )
    }
    const result = prepare().then(
      value => value,
      error => error,
    )
    await entered.promise
    if (event === 'delete') {
      await remove()
    } else {
      f.runtime.owner.reserve('agent')
    }
    release.resolve()
    expect(await result).toMatchObject({
      code: 'agent.managed_launch_rejected',
      details: { reason: 'superseded' },
    })
    expect([...f.alive]).toEqual([])
    // Successful kills alone cannot prove that no shell startup commands ran.
    expect(f.spawn).not.toHaveBeenCalled()
    if (gap === 'activity') {
      expect(dispose).toHaveBeenCalledTimes(1)
    }
  })
})
