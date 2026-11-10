// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { snapshotFixture, type SnapshotFixture } from './managedClaudeSnapshotFixture'
import { ManagedClaudeLaunchOwner as Owner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { deferred } from '../../unit/contexts/managedClaudeLaunchCompatibility.helpers'
import { withManagedClaudeFallback } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'

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
describeWithElectronNativeModules('managed Claude rejected fallback handoff', () => {
  let root: string, f: SnapshotFixture
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-fallback-handoff-'))
  })
  afterEach(async () => {
    f?.dispose()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  it('cleans a retained shell when constructing the returned result throws', async () => {
    f = await snapshotFixture(join(root, 'state.db'), null, true, 'prepareStoppedFallback')
    const attempt = f.runtime.owner.reserve('agent')
    await expect(
      f.runtime.withPreparation(attempt, () =>
        withManagedClaudeFallback(
          { cwd: '/repo/project', mountId: null, endpointId: 'local' },
          async () => ({
            ...(await f.spawn({})),
            get profileId(): string {
              throw new Error('result mapping failed')
            },
          }),
        ),
      ),
    ).rejects.toThrow('result mapping failed')
    expect(f.alive.size).toBe(0)
    expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
  })
  it.each(
    (['retention', 'finalization'] as const).flatMap(boundary =>
      [false, true].map(predecessor => ({ boundary, predecessor })),
    ),
  )(
    'cleans the unreturned shell after $boundary is superseded by a rejected request, predecessor=$predecessor',
    async ({ boundary, predecessor }) => {
      f = await snapshotFixture(join(root, 'state.db'), null, true, 'prepareStoppedFallback')
      const previous = predecessor
        ? (
            await f.invoke<{ nodes: { sessionId: string }[] }>({
              kind: 'command',
              id: 'session.prepareOrRevive',
              payload: { workspaceId: 'project', nodeIds: ['agent'] },
            })
          ).nodes[0].sessionId
        : null
      const entered = deferred<void>(),
        release = deferred<void>()
      let retained = false,
        blocked = false,
        shell = ''
      const retain = Owner.prototype.retainFallbackRuntime
      vi.spyOn(Owner.prototype, 'retainFallbackRuntime').mockImplementation(
        async function (attempt, id) {
          await retain.call(this, attempt, id)
          retained = true
          shell = id
          if (boundary === 'retention') {
            entered.resolve()
            await release.promise
          }
        },
      )
      const finish = Owner.prototype.finishLaunch
      vi.spyOn(Owner.prototype, 'finishLaunch').mockImplementation(async function (attempt) {
        if (retained && !blocked && boundary === 'finalization') {
          blocked = true
          entered.resolve()
          await release.promise
        }
        await finish.call(this, attempt)
      })
      const result = f
        .invoke({
          kind: 'command',
          id: 'session.prepareOrRevive',
          payload: { workspaceId: 'project', nodeIds: ['agent'] },
        })
        .then(
          value => value,
          error => error,
        )
      await entered.promise
      await expect(
        f.launch({
          canvasNodeId: 'agent',
          workspaceId: 'project',
          cwd: '/repo/project',
          provider: 'claude-code',
          prompt: 'fixture',
          intent: {
            kind: 'launchNew',
            expected: {
              activationId: 'wrong',
              tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
            },
          },
        }),
      ).rejects.toMatchObject({ code: 'agent.managed_launch_rejected' })
      release.resolve()
      expect(await result).toMatchObject({
        code: 'agent.managed_launch_rejected',
        details: { reason: 'superseded' },
      })
      expect(f.alive.has(shell)).toBe(false)
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual(previous ? [previous] : [])
      if (previous) {
        expect(f.alive.has(previous)).toBe(true)
      }
      expect(f.store.observeManagedClaudeNode('agent')).toMatchObject({
        binding: { runtimeSessionId: null },
        nodeRuntimeSessionId: null,
      })
    },
  )
})
