import { WorkspaceBootstrapMutationOwner } from '../../../src/contexts/workspace/application/workspaceBootstrapMutationOwner'
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  addProject,
  createSpace,
  type WorkspaceBootstrapPorts,
} from '../../../src/contexts/workspace/application/workspaceBootstrap'
import type { NodeControlAppState } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import {
  createProjectRecord,
  createTopLevelSpaceRecord,
} from '../../../src/contexts/workspace/domain/workspaceBootstrap'
import type { MountDto } from '../../../src/shared/contracts/dto'

function fixture() {
  let state: NodeControlAppState | null = null
  let revision = 0
  let id = 0
  const mounts: MountDto[] = []
  const ports: WorkspaceBootstrapPorts = {
    mutationOwner: new WorkspaceBootstrapMutationOwner(),
    validateSpaceDirectory: async (mount, directoryPath) => directoryPath ?? mount.rootPath,
    store: {
      readAppState: async () => state,
      readAppStateRevision: async () => revision,
      writeAppState: async (next, options) => {
        expect(options?.expectedRevision).toBe(revision)
        state = next
        return { ok: true, revision: ++revision }
      },
    },
    createId: () => `id-${++id}`,
    validateDirectory: async path => path,
    approveRoot: vi.fn(),
    listMounts: async projectId => mounts.filter(mount => mount.projectId === projectId),
    createMount: async (projectId, rootPath) => {
      const mount = {
        mountId: `mount-${++id}`,
        projectId,
        rootPath,
        endpointId: 'local',
        sortOrder: 0,
      } as MountDto
      mounts.push(mount)
      return mount
    },
  }
  return { ports, state: () => state!, revision: () => revision, mounts }
}

describe('workspace bootstrap', () => {
  it('bootstraps empty profiles with the shared UI record constructors and preserves existing projects', async () => {
    const f = fixture()
    const first = await addProject(f.ports, { path: '/project', name: 'Project' })
    const workspace = f.state().workspaces[0]
    expect(first).toMatchObject({
      project: { id: workspace.id, name: workspace.name, path: workspace.path },
      space: workspace.spaces[0],
    })
    expect(workspace).toEqual({
      ...createProjectRecord({ id: first.projectId, path: '/project', name: 'Project' }),
      spaces: [
        createTopLevelSpaceRecord({
          id: first.spaceId,
          name: 'Space 1',
          directoryPath: '/project',
          targetMountId: first.mountId,
          rect: workspace.spaces[0].rect,
        }),
      ],
    })
    await addProject(f.ports, { path: '/second' })
    expect(f.state().workspaces[0]).toEqual(workspace)
    expect(f.state().workspaces).toHaveLength(2)
    expect(f.revision()).toBe(2)
  })
  it('reuses duplicate paths without duplicating projects, mounts or spaces', async () => {
    const f = fixture()
    const first = await addProject(f.ports, { path: '/project' })
    expect(await addProject(f.ports, { path: '/project', name: 'Ignored' })).toEqual(first)
    expect(f.mounts).toHaveLength(1)
    expect(f.state().workspaces).toHaveLength(1)
  })
  it('creates nonoverlapping top-level spaces bound to the default mount', async () => {
    const f = fixture()
    const project = await addProject(f.ports, { path: '/project' })
    const result = await createSpace(f.ports, { projectId: project.projectId, name: 'Second' })
    const spaces = f.state().workspaces[0].spaces
    expect(result).toMatchObject({ space: spaces[1] })
    expect(result.mountId).toBe(project.mountId)
    expect(spaces[1]).toEqual(
      createTopLevelSpaceRecord({
        id: result.spaceId,
        name: 'Second',
        directoryPath: '/project',
        targetMountId: project.mountId,
        rect: spaces[1].rect,
      }),
    )
    const [a, b] = spaces.map(space => space.rect!)
    expect(
      a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y,
    ).toBe(true)
  })
  it('rejects empty-profile space creation and invalid directories before side effects', async () => {
    const f = fixture()
    await expect(createSpace(f.ports, { projectId: 'missing', name: 'Space' })).rejects.toThrow()
    f.ports.validateDirectory = async () => {
      throw new Error('invalid path')
    }
    await expect(addProject(f.ports, { path: 'bad' })).rejects.toThrow('invalid path')
    expect(f.ports.approveRoot).not.toHaveBeenCalled()
    expect(f.revision()).toBe(0)
  })
  it('retains published mounts when the revision write fails', async () => {
    const f = fixture()
    f.ports.store.writeAppState = async () => {
      throw new Error('conflict')
    }
    await expect(addProject(f.ports, { path: '/project' })).rejects.toThrow('conflict')
    expect(f.mounts).toHaveLength(1)
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

it('serializes allocation and failed commit before concurrent add and space creation', async () => {
  const f = fixture()
  await f.ports.store.writeAppState(
    {
      formatVersion: 1,
      activeWorkspaceId: 'existing',
      settings: {},
      workspaces: [createProjectRecord({ id: 'existing', name: 'Existing', path: '/project' })],
    },
    { expectedRevision: 0 },
  )
  const entered = deferred()
  const release = deferred()
  const write = f.ports.store.writeAppState
  let first = true
  f.ports.store.writeAppState = async (...args) => {
    if (first) {
      first = false
      entered.resolve()
      await release.promise
      throw new Error('conflict')
    }
    return write(...args)
  }
  const a = addProject(f.ports, { path: '/project' })
  const failed = expect(a).rejects.toThrow('conflict')
  await entered.promise
  const list = vi.spyOn(f.ports, 'listMounts')
  const b = addProject(f.ports, { path: '/project' })
  const c = createSpace(f.ports, { projectId: 'existing', name: 'Concurrent' })
  await Promise.resolve()
  expect(list).not.toHaveBeenCalled()
  release.resolve()
  await failed
  const [added, created] = await Promise.all([b, c])
  expect(added.mountId).toBe(created.mountId)
  expect(f.mounts.map(mount => mount.mountId)).toContain(created.mountId)
  expect(f.state().workspaces[0].spaces).toHaveLength(2)
})

it('does not delete a mount adopted by a writer outside the bootstrap queue', async () => {
  const f = fixture()
  await f.ports.store.writeAppState(
    {
      formatVersion: 1,
      activeWorkspaceId: 'existing',
      settings: {},
      workspaces: [createProjectRecord({ id: 'existing', name: 'Existing', path: '/project' })],
    },
    { expectedRevision: 0 },
  )
  const write = f.ports.store.writeAppState
  f.ports.store.writeAppState = async () => {
    const state = f.state()
    await write(
      {
        ...state,
        workspaces: [
          {
            ...state.workspaces[0],
            spaces: [
              createTopLevelSpaceRecord({
                id: 'adopted',
                name: 'Renderer',
                directoryPath: '/project',
                targetMountId: f.mounts[0].mountId,
                rect: null,
              }),
            ],
          },
        ],
      },
      { expectedRevision: f.revision() },
    )
    throw new Error('revision conflict')
  }
  await expect(addProject(f.ports, { path: '/project' })).rejects.toThrow('revision conflict')
  expect(f.mounts.map(mount => mount.mountId)).toContain(
    f.state().workspaces[0].spaces[0].targetMountId,
  )
})
