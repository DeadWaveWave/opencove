// @vitest-environment node
import { expect, it, vi } from 'vitest'
import * as z from 'zod'
import { resolve } from 'node:path'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerWorkspaceBootstrapHandlers } from '../../../src/app/main/controlSurface/handlers/workspaceBootstrapHandlers'
import { projectAddOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/project'
import { spaceCreateOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/space'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { createInMemoryPersistenceStore } from './controlSurfaceHttpServer.sessionStreaming.testUtils'

it('exports field-level schemas with the intended authority', () => {
  expect(projectAddOperation.scope).toBe('admin')
  expect(spaceCreateOperation.scope).toBe('interact')
  for (const [operation, properties] of [
    [projectAddOperation, ['path', 'name']],
    [spaceCreateOperation, ['projectId', 'name', 'directoryPath']],
  ] as const) {
    const schema = z.toJSONSchema(operation.input, { io: 'input', unrepresentable: 'throw' })
    expect(Object.keys(schema.properties ?? {})).toEqual(properties)
    expect(
      operation.normalize(
        operation.input.parse(Object.fromEntries(properties.map(key => [key, ' value ']))),
      ),
    ).toEqual(Object.fromEntries(properties.map(key => [key, 'value'])))
  }
})

it.each(['relative', '/definitely-missing-opencove-p1c', resolve('package.json')])(
  'rejects invalid directory %s before approval',
  async path => {
    const surface = createControlSurface()
    const approve = vi.fn()
    registerWorkspaceBootstrapHandlers(surface, {
      getPersistenceStore: async () => createInMemoryPersistenceStore(),
      approvedWorkspaces: { registerRoot: approve },
      topology: {},
    } as unknown as Parameters<typeof registerWorkspaceBootstrapHandlers>[1])
    const result = await surface.invoke({ now: () => new Date() } as ControlSurfaceContext, {
      kind: 'command',
      id: 'project.add',
      payload: { path },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
    expect(approve).not.toHaveBeenCalled()
  },
)

it('returns committed creation details while retaining the original IDs', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'opencove-bootstrap-output-'))
  try {
    const store = createInMemoryPersistenceStore()
    const surface = createControlSurface()
    const mounts: import('../../../src/shared/contracts/dto').MountDto[] = []
    registerWorkspaceBootstrapHandlers(surface, {
      getPersistenceStore: async () => store,
      approvedWorkspaces: { registerRoot: vi.fn() },
      topology: {
        listMounts: async () => ({ mounts }),
        createMount: async (input: object) => {
          const mount = {
            ...input,
            mountId: 'default-mount',
            sortOrder: 0,
          } as import('../../../src/shared/contracts/dto').MountDto
          mounts.push(mount)
          return { mount }
        },
      },
    } as unknown as Parameters<typeof registerWorkspaceBootstrapHandlers>[1])
    const ctx = { now: () => new Date() } as ControlSurfaceContext
    const added = await surface.invoke(ctx, {
      kind: 'command',
      id: 'project.add',
      payload: { path: root, name: 'Project' },
    })
    expect(added.ok).toBe(true)
    if (!added.ok) {
      throw new Error('project.add failed')
    }
    const value =
      added.value as import('../../../src/shared/contracts/dto/workspaceBootstrap').AddProjectResult
    expect(value.project).toMatchObject({ id: value.projectId, name: 'Project' })
    expect(value.space).toMatchObject({ id: value.spaceId, name: 'Space 1' })
    const created = await surface.invoke(ctx, {
      kind: 'command',
      id: 'space.create',
      payload: { projectId: value.projectId, name: 'Review' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error('space.create failed')
    }
    const result =
      created.value as import('../../../src/shared/contracts/dto/workspaceBootstrap').CreateSpaceResult
    const state = (await store.readAppState()) as { workspaces: Array<{ spaces: unknown[] }> }
    expect(state.workspaces[0].spaces).toEqual(expect.arrayContaining([result.space]))
    expect(result.space).toMatchObject({
      id: result.spaceId,
      name: 'Review',
      directoryPath: value.project.path,
      targetMountId: result.mountId,
    })
    expect(result.space.rect?.width).toBeGreaterThan(0)
    expect(result.space.rect?.height).toBeGreaterThan(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
