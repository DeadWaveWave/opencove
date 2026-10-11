// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerPluginSidebarHandlers } from '../../../src/app/main/controlSurface/handlers/pluginSidebarHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PluginInstallationManager } from '../../../src/contexts/plugins/application/PluginInstallationManager'
import type { PluginManifest } from '../../../src/contexts/plugins/domain/pluginTypes'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const context: ControlSurfaceContext = {
  now: () => new Date('2026-10-11T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: false,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 0,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: false, cookieSession: false },
    },
  },
}
const selection = {
  pluginId: 'sidebar-contract',
  sectionId: 'checks',
  projectId: 'selected-project',
  expectedRevision: 'revision-a',
  expectedRuntimeGeneration: 4,
}
const validItems = {
  items: [
    {
      id: 'group',
      label: 'Checks',
      children: [
        { id: 'check', label: 'Inspect', command: { id: 'inspect', params: { mode: 'quick' } } },
      ],
    },
  ],
}

async function fixture() {
  const state = createMinimalState('/fixture/project', selection.projectId, 'space')
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(state)
  let manifest: PluginManifest = {
    id: selection.pluginId,
    version: '1.0.0',
    displayName: 'Sidebar contract',
    description: 'Contract fixture',
    nodeKinds: [],
    actionBar: false,
    contextMenu: false,
    enabled: true,
    status: 'ready',
    revision: selection.expectedRevision,
    runtimeGeneration: selection.expectedRuntimeGeneration,
    sidebar: [{ id: selection.sectionId, title: 'Checks', itemsCommand: 'list-checks' }],
    commands: [
      { id: 'list-checks', title: 'List', description: 'Read checks', target: 'plugin' },
      {
        id: 'inspect',
        title: 'Inspect',
        description: 'Inspect item',
        target: 'plugin',
        menus: ['sidebar'],
      },
      {
        id: 'window-only',
        title: 'Window',
        description: 'Window action',
        target: 'window',
        menus: ['sidebar'],
      },
    ],
  }
  const list = vi.fn(async () => [manifest])
  const runCommand = vi.fn(async (): Promise<unknown> => validItems)
  const control = createControlSurface()
  registerPluginSidebarHandlers(control, {
    plugins: { list, runCommand } as unknown as PluginInstallationManager,
    getPersistenceStore: async () => store,
  })
  const call = (payload: unknown = selection) =>
    control.invoke(context, { kind: 'query', id: 'plugin.sidebar.items', payload })
  return {
    call,
    runCommand,
    store,
    state,
    manifest: () => manifest,
    changeManifest: (change: Partial<PluginManifest>) => {
      manifest = { ...manifest, ...change }
    },
  }
}

function expectFailure(
  result: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['call']>>,
  reason: string,
) {
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'plugin.operation_failed', debugMessage: expect.stringContaining(reason) },
  })
}

describe('plugin Sidebar control surface', () => {
  it('routes a declared provider to the selected project and exact admitted generation', async () => {
    const subject = await fixture()
    const admitted = subject.manifest()
    expect(await subject.call()).toMatchObject({ ok: true, value: validItems })
    expect(subject.runCommand).toHaveBeenCalledExactlyOnceWith(
      selection.pluginId,
      'list-checks',
      { projectId: selection.projectId },
      { context: { surface: 'sidebar', projectId: selection.projectId } },
      admitted,
    )
  })

  it.each([
    ['absent project', { projectId: 'deleted-project' }, 'project is no longer available'],
    ['stale revision', { expectedRevision: 'revision-old' }, 'Plugin changed'],
    ['stale generation', { expectedRuntimeGeneration: 3 }, 'Plugin changed'],
    ['undeclared section', { sectionId: 'other-section' }, 'section is not declared'],
  ])('rejects %s before invoking the backend', async (_name, patch, reason) => {
    const subject = await fixture()
    expectFailure(await subject.call({ ...selection, ...(patch as object) }), reason as string)
    expect(subject.runCommand).not.toHaveBeenCalled()
  })

  it.each([{ enabled: false }, { status: 'error' as const }, { status: 'disabled' as const }])(
    'does not run an unavailable plugin (%j)',
    async change => {
      const subject = await fixture()
      subject.changeManifest(change)
      expectFailure(await subject.call(), 'Plugin changed')
      expect(subject.runCommand).not.toHaveBeenCalled()
    },
  )

  it.each([
    { projectId: undefined },
    { expectedRuntimeGeneration: undefined },
    { expectedRuntimeGeneration: 4.5 },
    { expectedRuntimeGeneration: '4' },
    { commandId: 'arbitrary-command' },
  ])('rejects malformed or authority-expanding input (%j)', async patch => {
    const subject = await fixture()
    expect((await subject.call({ ...selection, ...patch })).ok).toBe(false)
    expect(subject.runCommand).not.toHaveBeenCalled()
  })

  it.each(['generation', 'project'] as const)(
    'rejects results when %s changes while the provider is pending',
    async change => {
      const subject = await fixture()
      let complete!: (value: unknown) => void
      subject.runCommand.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            complete = resolve
          }),
      )
      const pending = subject.call()
      await vi.waitFor(() => expect(subject.runCommand).toHaveBeenCalledOnce())
      if (change === 'generation') {
        subject.changeManifest({ runtimeGeneration: selection.expectedRuntimeGeneration + 1 })
      } else {
        expect(
          await subject.store.writeAppState(
            { ...subject.state, workspaces: [] },
            { allowEmptyWorkspaceOverwrite: true },
          ),
        ).toMatchObject({ ok: true })
      }
      complete(validItems)
      expectFailure(
        await pending,
        change === 'generation' ? 'Plugin changed' : 'project is no longer available',
      )
      expect(subject.runCommand).toHaveBeenCalledOnce()
    },
  )

  it.each(['missing', 'list-checks', 'window-only'])(
    'rejects a result action outside declared backend Sidebar commands (%s)',
    async id => {
      const subject = await fixture()
      subject.runCommand.mockResolvedValueOnce({
        items: [{ id: 'bad', label: 'Bad', command: { id } }],
      })
      expectFailure(await subject.call(), 'backend command declared for sidebar')
    },
  )

  it('rejects script-shaped result actions instead of forwarding them as runnable items', async () => {
    const subject = await fixture()
    subject.runCommand.mockResolvedValueOnce({
      items: [{ id: 'bad', label: 'Bad', command: { id: 'inspect', href: 'javascript:bad()' } }],
    })
    expectFailure(await subject.call(), 'Invalid plugin Sidebar fields')
  })
})
