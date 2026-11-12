// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { snapshotFixture, type SnapshotFixture } from './managedClaudeSnapshotFixture'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { createMountOnlySpaceBoundary } from '../../../src/shared/types/spaceBoundary'
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
describeWithElectronNativeModules('managed Claude fallback execution context', () => {
  let root: string, f: SnapshotFixture
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-fallback-context-'))
  })
  afterEach(async () => {
    f?.dispose()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  it('revalidates actual execution even when effect admission already succeeded', async () => {
    f = await snapshotFixture(join(root, 'state.db'), null, true, 'prepareStoppedFallback')
    const attempt = f.runtime.owner.reserve('agent')
    await f.runtime.withPreparation(attempt, async () => {
      await f.runtime.owner.admit(attempt, {
        provider: 'claude-code',
        cwd: '/repo/project',
        mountId: null,
      })
      const before = f.store.observeManagedClaudeNode('agent')
      await expect(
        withManagedClaudeFallback(
          { cwd: '/repo/other', mountId: null, endpointId: 'local' },
          async () => f.spawn({}),
        ),
      ).rejects.toMatchObject({
        code: 'agent.managed_launch_rejected',
        details: { reason: 'identityConflict' },
      })
      expect(f.store.observeManagedClaudeNode('agent')).toEqual(before)
      expect(f.spawn).not.toHaveBeenCalled()
    })
  })
  it.each(['boundary', 'remote'] as const)(
    'rejects stopped fallback after inherited Space %s changes before settlement or spawn',
    async change => {
      f = await snapshotFixture(join(root, 'state.db'), null, true, 'prepareStoppedFallback', true)
      const state = normalizePersistedAppState(await f.store.readAppState())!
      if (change === 'boundary') {
        state.workspaces[0].spaces[0].boundary = createMountOnlySpaceBoundary({
          mountId: 'mount',
          rootPath: '/repo/other',
          rootUri: 'file:///repo/other',
        })
      } else {
        f.mount.endpointId = 'remote'
      }
      await f.store.writeAppState(state)
      const before = f.store.observeManagedClaudeNode('agent')
      const revision = await f.store.readAppStateRevision()
      await expect(
        f.invoke({
          kind: 'command',
          id: 'session.prepareOrRevive',
          payload: { workspaceId: 'project', nodeIds: ['agent'] },
        }),
      ).rejects.toMatchObject({
        code: 'agent.managed_launch_rejected',
        details: { reason: 'identityConflict' },
      })
      expect(f.store.observeManagedClaudeNode('agent')).toEqual(before)
      expect(await f.store.readAppStateRevision()).toBe(revision)
      expect(f.spawn).not.toHaveBeenCalled()
      expect(f.publications).toEqual([])
      expect(f.runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
    },
  )
})
