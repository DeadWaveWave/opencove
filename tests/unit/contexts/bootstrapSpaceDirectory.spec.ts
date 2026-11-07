// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { resolve, join, win32 } from 'node:path'
import {
  relativeDirectoryWithinRoot,
  validateBootstrapSpaceDirectory,
} from '../../../src/contexts/workspace/infrastructure/approval/bootstrapSpaceDirectory'
import { createPersistedWorkspaceApprovalGate } from '../../../src/contexts/workspace/infrastructure/approval/PersistedWorkspaceApproval'
import { createProjectRecord } from '../../../src/contexts/workspace/domain/workspaceBootstrap'
import {
  createSpace,
  type WorkspaceBootstrapPorts,
} from '../../../src/contexts/workspace/application/workspaceBootstrap'
import { WorkspaceBootstrapMutationOwner } from '../../../src/contexts/workspace/application/workspaceBootstrapMutationOwner'
import type { MountDto } from '../../../src/shared/contracts/dto'
import type { NodeControlAppState } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'

it('rejects traversal and symlink escape before persistence and restart approval', async () => {
  await mkdir(resolve('.codex-out/tmp'), { recursive: true })
  const temp = await mkdtemp(resolve('.codex-out/tmp/space-directory-'))
  try {
    const root = join(temp, 'root')
    const outside = join(temp, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await mkdir(join(root, 'child'))
    await symlink(outside, join(root, 'escape'), 'junction')
    await symlink(join(root, 'child'), join(root, 'inside'), 'junction')
    const mount = {
      mountId: 'mount',
      projectId: 'project',
      endpointId: 'local',
      rootPath: root,
    } as MountDto
    let state: NodeControlAppState = {
      formatVersion: 1,
      activeWorkspaceId: 'project',
      settings: {},
      workspaces: [createProjectRecord({ id: 'project', name: 'Project', path: root })],
    }
    let writes = 0
    const ports = {
      mutationOwner: new WorkspaceBootstrapMutationOwner(),
      validateSpaceDirectory: validateBootstrapSpaceDirectory,
      listMounts: async () => [mount],
      createId: () => 'space',
      store: {
        readAppState: async () => state,
        readAppStateRevision: async () => writes,
        writeAppState: async (next: NodeControlAppState) => {
          state = next
          return { ok: true, revision: ++writes }
        },
      },
    } as WorkspaceBootstrapPorts
    await Promise.all(
      [outside, `${root}/../outside`, join(root, 'escape'), 'relative', join(root, 'missing')].map(
        directoryPath =>
          expect(
            createSpace(ports, { projectId: 'project', name: 'Unsafe', directoryPath }),
          ).rejects.toThrow(),
      ),
    )
    expect(writes).toBe(0)
    const approved: string[] = []
    await createPersistedWorkspaceApprovalGate({
      readAppState: async () => state,
      approvedWorkspaces: {
        registerRoot: async value => {
          approved.push(value)
        },
        isPathApproved: async () => false,
      },
    }).ready
    expect(approved).toEqual([root])
    await createSpace(ports, {
      projectId: 'project',
      name: 'Safe',
      directoryPath: join(root, 'inside'),
    })
    expect(state.workspaces[0].spaces[0].directoryPath).toBe(join(root, 'child'))
    expect(state.workspaces[0].spaces[0].targetMountId).toBe('mount')
    expect(await validateBootstrapSpaceDirectory(mount)).toBe(root)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

it('uses Windows drive and UNC containment semantics without cross-drive or prefix escapes', () => {
  expect(relativeDirectoryWithinRoot('C:\\Repo', 'c:\\repo\\child', win32)).toBe('child')
  for (const target of [
    'C:\\Repo\\..\\outside',
    'D:\\Repo\\child',
    'C:\\Repository',
    'C:relative',
  ]) {
    expect(() => relativeDirectoryWithinRoot('C:\\Repo', target, win32)).toThrow()
  }
  expect(
    relativeDirectoryWithinRoot('\\\\host\\share\\repo', '\\\\host\\share\\repo\\child', win32),
  ).toBe('child')
  expect(() =>
    relativeDirectoryWithinRoot('\\\\host\\share\\repo', '\\\\other\\share\\repo', win32),
  ).toThrow()
})

it('does not resolve remote overrides on the local filesystem', async () => {
  const mount = { endpointId: 'remote', rootPath: '/remote/project' } as MountDto
  await expect(validateBootstrapSpaceDirectory(mount)).rejects.toThrow()
  await Promise.all(
    ['/remote/project/child', '/remote/project/../outside', 'C:\\Repo', '/'].map(target =>
      expect(validateBootstrapSpaceDirectory(mount, target)).rejects.toThrow(),
    ),
  )
})

it('does not turn a remote default root into a local approval after restart', async () => {
  const state: NodeControlAppState = {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: {},
    workspaces: [createProjectRecord({ id: 'project', name: 'Project', path: '/local/project' })],
  }
  let writes = 0
  const ports = {
    mutationOwner: new WorkspaceBootstrapMutationOwner(),
    validateSpaceDirectory: validateBootstrapSpaceDirectory,
    listMounts: async () => [
      { mountId: 'remote-root', endpointId: 'remote', rootPath: '/' } as MountDto,
    ],
    store: {
      readAppState: async () => state,
      readAppStateRevision: async () => 0,
      writeAppState: async () => {
        writes++
        return { ok: true, revision: 1 }
      },
    },
  } as WorkspaceBootstrapPorts
  await expect(createSpace(ports, { projectId: 'project', name: 'Remote' })).rejects.toThrow()
  expect(writes).toBe(0)
  const approved: string[] = []
  await createPersistedWorkspaceApprovalGate({
    readAppState: async () => state,
    approvedWorkspaces: {
      registerRoot: async value => {
        approved.push(value)
      },
      isPathApproved: async () => false,
    },
  }).ready
  expect(approved).toEqual(['/local/project'])
})
