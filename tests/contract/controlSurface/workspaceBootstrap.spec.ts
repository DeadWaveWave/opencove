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
