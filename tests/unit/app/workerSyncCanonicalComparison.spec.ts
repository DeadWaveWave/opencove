import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { expect, it } from 'vitest'
import {
  shouldApplyWorkerSyncRefresh,
  resolveWorkspacesForWorkerSync,
} from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { fixture } from '../../support/convergence/fixture'
import { sqliteWireState } from '../../support/convergence/sqliteWire'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
it('does not apply a canonical echo solely because SQLite materializes defaults or local views differ', () => {
  const original = fixture(false)
  const workspaces = original.workspaces.map(workspace => toShellWorkspaceState(workspace))
  const canonical = sqliteWireState(
    toPersistedState(workspaces, original.activeWorkspaceId, original.settings),
  )
  canonical.workspaces[0].viewport = { x: 111, y: 222, zoom: 2 }
  canonical.workspaces[0].activeSpaceId = 'second'
  expect(
    shouldApplyWorkerSyncRefresh({
      currentState: {
        workspaces,
        activeWorkspaceId: original.activeWorkspaceId,
        agentSettings: original.settings,
      },
      persistedState: canonical,
    }),
  ).toBe(false)
  expect(
    resolveWorkspacesForWorkerSync({
      currentWorkspaces: workspaces,
      persistedWorkspaces: canonical.workspaces,
    }),
  ).toBe(workspaces)
})
it('preserves unchanged nodes while applying real plugin and website payload updates', () => {
  const original = fixture(false)
  const template = original.workspaces[0].nodes[1]
  original.workspaces[0].nodes = [
    {
      ...template,
      id: 'plugin',
      kind: 'plugin',
      agent: null,
      task: { pluginId: 'clock', schemaVersion: 1, repoPath: '/tmp/clock', mountId: null },
    },
    {
      ...template,
      id: 'web',
      kind: 'website',
      agent: null,
      task: {
        url: 'https://old.test',
        pinned: false,
        sessionMode: 'shared',
        profileId: null,
        browserMode: 'iframe',
      },
    },
  ]
  const workspaces = original.workspaces.map(workspace => toShellWorkspaceState(workspace))
  const cloned = structuredClone(original)
  const equal = resolveWorkspacesForWorkerSync({
    currentWorkspaces: workspaces,
    persistedWorkspaces: cloned.workspaces,
  })
  expect(equal).toBe(workspaces)
  cloned.workspaces[0].nodes[0].task = {
    pluginId: 'replacement',
    schemaVersion: 1,
    repoPath: '/tmp/replacement',
    mountId: null,
  }
  cloned.workspaces[0].nodes[1].task = {
    url: 'https://new.test',
    pinned: false,
    sessionMode: 'shared',
    profileId: null,
    browserMode: 'iframe',
  }
  const updated = resolveWorkspacesForWorkerSync({
    currentWorkspaces: workspaces,
    persistedWorkspaces: cloned.workspaces,
  })
  expect(updated[0].nodes[0].data.plugin?.pluginId).toBe('replacement')
  expect(updated[0].nodes[1].data.website?.url).toBe('https://new.test')
})
