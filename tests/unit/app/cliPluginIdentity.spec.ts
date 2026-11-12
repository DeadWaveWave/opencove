// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who } from './cliIdentity.helpers'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerPluginCommandHandlers } from '../../../src/app/main/controlSurface/handlers/pluginCommandHandlers'
import { registerPluginHandlers } from '../../../src/app/main/controlSurface/handlers/pluginHandlers'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import type { PluginInstallationManager } from '../../../src/contexts/plugins/application/PluginInstallationManager'
import type { PluginManifest } from '../../../src/contexts/plugins/domain/pluginTypes'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

async function pluginFixture(
  inside: boolean,
  target: 'plugin' | 'window',
  existingWindow: boolean | 'other' = false,
  sessionGrant = false,
) {
  const f = identityFixture(inside)
  const manifest: PluginManifest = {
    id: 'sample',
    version: '1.0.0',
    displayName: 'Sample',
    description: 'Fixture',
    revision: 'one',
    runtimeGeneration: 1,
    source: 'local',
    enabled: true,
    status: 'ready',
    nodeKinds: ['sample'],
    actionBar: true,
    contextMenu: true,
    view: {
      entry: 'index.html',
      instances: 'single',
      width: 440,
      height: 320,
      minWidth: 320,
      minHeight: 220,
    },
    commands: [{ id: 'inspect', title: 'Inspect', description: 'Inspect state', target }],
  }
  const store = createInMemoryPersistenceStore()
  const initial = createMinimalState('/repo', who.projectId, who.spaceId)
  initial.workspaces.push(
    ...createMinimalState('/other', 'project-other', 'space-other').workspaces,
  )
  f.values['project.list'] = {
    projects: [
      { id: who.projectId, name: 'Project' },
      { id: 'project-other', name: 'Other' },
    ],
  }
  await store.writeAppState(initial)
  const read = vi.spyOn(store, 'readAppState')
  const write = vi.spyOn(store, 'writeAppState')
  const plugins = {
    list: vi.fn(async () => [manifest]),
    details: vi.fn(async () => ({
      plugin: manifest,
      readme: '',
      assets: {},
      sourceDirectory: null,
      logs: [],
    })),
    listViews: vi.fn(async () => {
      const state = (await store.readAppState()) as {
        workspaces: { nodes: { id: string }[] }[]
      }
      return state.workspaces.flatMap(workspace =>
        workspace.nodes.map(saved => ({ viewId: 'ready-view', nodeId: saved.id, ready: true })),
      )
    }),
    runCommand: vi.fn(async (_pluginId: string, _commandId: string, _params: unknown) => ({
      executed: true,
    })),
  }
  const control = createControlSurface()
  const manager = plugins as unknown as PluginInstallationManager
  registerPluginHandlers(control, manager)
  registerPluginCommandHandlers(control, {
    plugins: manager,
    getPersistenceStore: async () => store,
    publishSyncEvent: () => 1,
  })
  registerSystemHandlers(control, { appVersion: null })
  const ctx = {
    now: () => new Date(),
    requestAuth: sessionGrant
      ? {
          kind: 'session-grant',
          grant: {
            ...who,
            grantId: 'grant',
            tier: 'interact',
            createdAt: new Date().toISOString(),
          },
        }
      : { kind: 'bearer' },
  } as ControlSurfaceContext
  control.register('node.get', {
    kind: 'query',
    validate: value => value as { nodeId: string },
    handle: async (_ctx, input) => {
      const state = (await store.readAppState()) as {
        workspaces: { id: string; nodes: { id: string }[] }[]
      }
      const saved = state.workspaces
        .flatMap(workspace => workspace.nodes.map(node => ({ ...node, projectId: workspace.id })))
        .find(item => item.id === input.nodeId)
      if (!saved) {
        throw new Error('Node was not found')
      }
      return { node: saved }
    },
    defaultErrorCode: 'node.not_found',
  })
  let existingNodeId: string | undefined
  if (existingWindow) {
    const result = await control.invoke(
      { ...ctx, requestAuth: { kind: 'bearer' } },
      {
        kind: 'command',
        id: 'plugin.window.open',
        payload: {
          pluginId: 'sample',
          projectId: existingWindow === 'other' ? 'project-other' : who.projectId,
        },
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      existingNodeId = (result.value as { nodeId: string }).nodeId
    }
    write.mockClear()
  }
  read.mockClear()
  f.io.fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    f.requests.push(request)
    if (request.id === 'system.whoami' && inside && !sessionGrant) {
      return new Response(JSON.stringify({ ok: true, value: who }))
    }
    if (request.id === 'project.list') {
      return new Response(JSON.stringify({ ok: true, value: f.values['project.list'] }))
    }
    return new Response(JSON.stringify(await control.invoke(ctx, request)))
  })
  return { ...f, plugins, store, read, write, manifest, existingNodeId }
}

it.each([true, false])(
  'runs a plugin-wide command without a project inside=%s through the real handler',
  async inside => {
    const f = await pluginFixture(inside, 'plugin')
    expect(await run(['plugin', 'run', 'sample', 'inspect'], f.io)).toBe(0)
    expect(f.plugins.runCommand).toHaveBeenCalledTimes(1)
    expect(
      f.requests.find(request => request.id === 'plugin.command.run')?.payload,
    ).not.toHaveProperty('projectId')
    expect(f.read).not.toHaveBeenCalled()
    expect(f.write).not.toHaveBeenCalled()
    expect(JSON.parse(f.out())).toEqual({ executed: true })
  },
)

it.each([false, true])(
  'defaults project only for a window command inside OpenCove (missing env project=%s)',
  async missing => {
    const f = await pluginFixture(true, 'window')
    if (missing) {
      delete f.io.env.OPENCOVE_PROJECT_ID
    }
    expect(await run(['plugin', 'run', 'sample', 'inspect', '--params', '{"limit":3}'], f.io)).toBe(
      0,
    )
    expect(f.plugins.runCommand).toHaveBeenCalledTimes(1)
    expect(f.plugins.runCommand.mock.calls[0][2]).toEqual({ limit: 3 })
    expect(f.requests.find(request => request.id === 'plugin.command.run')?.payload).toMatchObject({
      projectId: who.projectId,
    })
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.requests.filter(request => request.id === 'system.whoami')).toHaveLength(
      missing ? 1 : 0,
    )
  },
)

it('does not default a project outside OpenCove when a window must be created', async () => {
  const f = await pluginFixture(false, 'window')
  expect(await run(['plugin', 'run', 'sample', 'inspect'], f.io)).toBe(1)
  expect(f.error().message).toContain('Specify --project')
  expect(f.plugins.runCommand).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled()
})

it('honors an explicit project selector for a window command', async () => {
  const f = await pluginFixture(true, 'window')
  expect(await run(['plugin', 'run', 'sample', 'inspect', '--project', 'Project'], f.io)).toBe(0)
  expect(f.requests.find(request => request.id === 'plugin.command.run')?.payload).toMatchObject({
    projectId: who.projectId,
  })
  expect(f.plugins.runCommand).toHaveBeenCalledTimes(1)
})

it('keeps explicit forbidden plugin-wide targets visible to the server', async () => {
  const f = await pluginFixture(true, 'plugin')
  expect(await run(['plugin', 'run', 'sample', 'inspect', '--project', '@self'], f.io)).toBe(1)
  expect(f.error().message).toContain('Plugin-wide commands do not accept')
  expect(f.plugins.runCommand).not.toHaveBeenCalled()
})

it('keeps an existing window command usable outside OpenCove without a default project', async () => {
  const f = await pluginFixture(false, 'window', true)
  expect(await run(['plugin', 'run', 'sample', 'inspect'], f.io)).toBe(0)
  expect(f.plugins.runCommand).toHaveBeenCalledTimes(1)
  expect(f.write).not.toHaveBeenCalled()
})

it('rejects stale command metadata before a window command can run', async () => {
  const f = await pluginFixture(true, 'window')
  const transport = f.io.fetch
  f.io.fetch = vi.fn(async (url, init) => {
    const response = await transport(url, init)
    if (JSON.parse(String(init?.body)).id === 'plugin.details') {
      f.manifest.revision = 'two'
    }
    return response
  })
  expect(await run(['plugin', 'run', 'sample', 'inspect'], f.io)).toBe(1)
  expect(f.error().message).toContain('Plugin changed before command dispatch')
  expect(f.plugins.runCommand).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled()
})

it.each([true, false])(
  'opens an explicit existing node in B without an implicit A target (inside=%s)',
  async inside => {
    const f = await pluginFixture(inside, 'window', 'other')
    expect(await run(['plugin', 'open', 'sample', '--node', f.existingNodeId!], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toMatchObject({
      nodeId: f.existingNodeId,
      projectId: 'project-other',
      created: false,
    })
    expect(
      f.requests.find(request => request.id === 'plugin.window.open')?.payload,
    ).not.toHaveProperty('projectId')
    expect(f.write).not.toHaveBeenCalled()
  },
)

it.each(['@self', 'Other'])(
  'preserves explicit project validation for an existing node in B: %s',
  async selector => {
    const f = await pluginFixture(true, 'window', 'other')
    expect(
      await run(
        ['plugin', 'open', 'sample', '--node', f.existingNodeId!, '--project', selector],
        f.io,
      ),
    ).toBe(selector === '@self' ? 1 : 0)
    if (selector === '@self') {
      expect(f.error()).toMatchObject({
        code: 'node.not_found',
        message: expect.stringContaining(
          `belongs to project "project-other", not to the selected project "${who.projectId}"`,
        ),
      })
      expect(f.requests.some(request => request.id === 'plugin.window.open')).toBe(false)
    } else {
      expect(JSON.parse(f.out())).toMatchObject({ projectId: 'project-other', created: false })
    }
    expect(f.write).not.toHaveBeenCalled()
  },
)

it.each(['revision', 'generation'])(
  'rejects plugin-to-window reloads after metadata lookup (%s)',
  async changed => {
    const f = await pluginFixture(true, 'plugin', 'other')
    const transport = f.io.fetch
    f.io.fetch = vi.fn(async (url, init) => {
      const response = await transport(url, init)
      if (JSON.parse(String(init?.body)).id === 'plugin.details') {
        f.manifest.commands![0].target = 'window'
        if (changed === 'revision') {
          f.manifest.revision = 'two'
        } else {
          f.manifest.runtimeGeneration = 2
        }
      }
      return response
    })
    expect(await run(['plugin', 'run', 'sample', 'inspect'], f.io)).toBe(1)
    expect(f.error().message).toContain('Plugin changed before command dispatch')
    expect(f.requests.find(request => request.id === 'plugin.command.run')?.payload).toMatchObject({
      expectedRevision: 'one',
      expectedRuntimeGeneration: 1,
    })
    expect(f.plugins.runCommand).not.toHaveBeenCalled()
    expect(f.write).not.toHaveBeenCalled()
  },
)

it('refuses plugin execution under a session grant before side effects', async () => {
  const f = await pluginFixture(true, 'plugin', false, true)
  const args = ['plugin', 'run', 'sample', 'inspect']
  expect(await run(args, f.io)).toBe(4)
  expect(f.error()).toMatchObject({
    code: 'common.forbidden',
    details: { reason: 'operation_denied' },
  })
  expect(f.plugins.runCommand).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled()
})
