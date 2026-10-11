// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  listPluginTargets,
  pluginRelativeUri,
  pluginTargetInput,
  resolvePluginTarget,
} from '../../../../src/app/main/controlSurface/handlers/pluginTargetResolution'
import type { PersistenceStore } from '../../../../src/platform/persistence/sqlite/PersistenceStore'
import type { MountDto } from '../../../../src/shared/contracts/dto'
import { resolve } from 'node:path'
import type { PluginResolvedTarget } from '../../../../src/contexts/plugins/domain/pluginHostTypes'
const mount: MountDto = {
  mountId: 'm',
  projectId: 'p',
  name: 'remote',
  sortOrder: 0,
  endpointId: 'remote',
  targetId: 't',
  rootPath: '/remote/repo',
  rootUri: 'file:///remote/repo',
  createdAt: '',
  updatedAt: '',
}
const target: PluginResolvedTarget = {
  projectId: 'p',
  spaceId: null,
  mountId: 'm',
  endpointId: 'remote',
  rootUri: mount.rootUri,
  cwdUri: mount.rootUri,
  workingDirectory: mount.rootPath,
}
function fixture(spaceMountId: string | null = 'm') {
  const raw = {
    formatVersion: 1,
    activeWorkspaceId: 'p',
    settings: {},
    workspaces: [
      {
        id: 'p',
        name: 'Project',
        path: resolve('/metadata-placeholder'),
        nodes: [],
        spaces: [
          {
            id: 's',
            name: 'Space',
            directoryPath: '/remote/repo/sub',
            targetMountId: spaceMountId,
            nodeIds: [],
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    ],
  }
  return {
    getPersistenceStore: async () =>
      ({ readAppState: async () => raw }) as unknown as PersistenceStore,
    topology: {
      listMounts: async () => ({ projectId: 'p', mounts: [mount] }),
      resolveMountTarget: async () => mount,
    },
  }
}
describe('plugin execution targets', () => {
  it('lists project/Space identities without resolving a mount or choosing a target', async () => {
    const deps = fixture('deleted')
    expect(await listPluginTargets(deps)).toEqual({
      projects: [{ id: 'p', name: 'Project', spaces: [{ id: 's', name: 'Space' }] }],
    })
    expect(
      await listPluginTargets({
        getPersistenceStore: async () =>
          ({ readAppState: async () => null }) as unknown as PersistenceStore,
      }),
    ).toEqual({ projects: [] })
  })
  it('requires project even when one exists and never guesses a project', () => {
    expect(() => pluginTargetInput({})).toThrow()
    expect(() => pluginTargetInput({ projectId: 'p', mountId: 'guessed' })).toThrow()
  })
  it('uses the remote project mount instead of the local metadata path', async () => {
    expect(await resolvePluginTarget({ projectId: 'p' }, fixture())).toEqual(target)
    expect(await resolvePluginTarget({ projectId: 'p', spaceId: 's' }, fixture())).toMatchObject({
      endpointId: 'remote',
      cwdUri: 'file:///remote/repo/sub',
    })
  })
  it('rejects disappeared explicit mounts and wrong Space ownership', async () => {
    await expect(
      resolvePluginTarget({ projectId: 'p', spaceId: 's' }, fixture('deleted')),
    ).rejects.toThrow('mount is unavailable')
    await expect(
      resolvePluginTarget({ projectId: 'p', spaceId: 'unknown' }, fixture()),
    ).rejects.toThrow('does not belong')
  })
  it('handles Windows and encoded filenames without allowing path or host escapes', () => {
    expect(pluginRelativeUri({ ...target, cwdUri: 'file:///C:/repo' }, 'docs\\hello #.md')).toBe(
      'file:///C:/repo/docs/hello%20%23.md',
    )
    for (const path of ['../secret', '/tmp/file', 'C:\\file', '\\\\server\\file', 'a/../secret']) {
      expect(() => pluginRelativeUri(target, path)).toThrow()
    }
    expect(pluginRelativeUri(target, ' trailing .txt ')).toBe(
      'file:///remote/repo/%20trailing%20.txt%20',
    )
    expect(pluginRelativeUri(target, '%2e%2e')).toBe('file:///remote/repo/%252e%252e')
  })
})
