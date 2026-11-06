// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerFilesystemHandlers } from '../../../src/app/main/controlSurface/handlers/filesystemHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { AppErrorCode } from '../../../src/shared/contracts/dto'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { createAppError } from '../../../src/shared/errors/appError'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const context = { now: () => new Date() } as ControlSurfaceContext

async function expectDeclaredFailure(
  surface: ReturnType<typeof createControlSurface>,
  id: string,
  payload: unknown,
  code: AppErrorCode,
) {
  const result = await surface.invoke(context, { kind: 'command', id, payload })
  expect(result).toMatchObject({ ok: false, error: { code } })
  const operation = getControlSurfaceOperation(id)
  expect(operation?.contract).toBe('schema')
  if (operation?.contract !== 'schema' || result.ok) {
    throw new Error('Expected a schema operation failure')
  }
  expect(operation.errors).toContain(result.error.code)
}

function sessionSurface(store: ReturnType<typeof createInMemoryPersistenceStore>) {
  const surface = createControlSurface()
  const spawnSession = vi.fn(() => {
    throw new Error('Unexpected spawn')
  })
  registerSessionHandlers(surface, {
    getPersistenceStore: async () => store,
    ptyRuntime: { spawnSession },
    ptyStreamHub: {},
  } as Parameters<typeof registerSessionHandlers>[1])
  return { surface, spawnSession }
}

it('declares the real unknown-space session launch failure before spawn', async () => {
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(createMinimalState('/repo', 'project', 'existing-space'))
  const { surface, spawnSession } = sessionSurface(store)
  await expectDeclaredFailure(
    surface,
    'session.launchAgent',
    { spaceId: 'deleted-space', prompt: '' },
    'space.not_found',
  )
  expect(spawnSession).not.toHaveBeenCalled()
})

it.each(['session.launchAgent', 'node.create'])(
  'declares persistence read failure for %s',
  async id => {
    const store = createInMemoryPersistenceStore()
    store.readAppState = async () => {
      throw createAppError('persistence.unavailable')
    }
    const surface =
      id === 'session.launchAgent' ? sessionSurface(store).surface : createControlSurface()
    if (id === 'node.create') {
      registerNodeControlHandlers(surface, { getPersistenceStore: async () => store } as Parameters<
        typeof registerNodeControlHandlers
      >[1])
    }
    const payload =
      id === 'session.launchAgent'
        ? { spaceId: 'space', prompt: '' }
        : { kind: 'note', projectId: 'project' }
    await expectDeclaredFailure(surface, id, payload, 'persistence.unavailable')
  },
)

it.each([
  'worktree.git_unavailable',
  'worktree.not_a_git_repo',
  'worktree.list_worktrees_failed',
] as const)('declares %s propagated through node workerBranch lookup', async code => {
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(createMinimalState('/repo', 'project', 'space'))
  const surface = createControlSurface()
  const lookup = vi.fn(() => {
    throw createAppError(code)
  })
  // Inject the downstream query failure at the existing Control Surface boundary.
  surface.register('gitWorktree.listWorktrees', {
    kind: 'query',
    validate: value => value,
    handle: lookup,
    defaultErrorCode: 'worktree.list_worktrees_failed',
  })
  registerNodeControlHandlers(surface, {
    getPersistenceStore: async () => store,
    topology: {
      listEndpoints: async () => ({
        endpoints: [{ endpointId: 'local', kind: 'local', displayName: 'Local' }],
      }),
      listMounts: async () => ({ mounts: [] }),
    },
  } as Parameters<typeof registerNodeControlHandlers>[1])
  await expectDeclaredFailure(
    surface,
    'node.create',
    { kind: 'note', space: { kind: 'workerBranch', worker: 'local', branch: 'main' } },
    code,
  )
  expect(lookup).toHaveBeenCalledOnce()
})

it('declares a real filesystem write failure', async () => {
  const surface = createControlSurface()
  registerFilesystemHandlers(surface, {
    approvedWorkspaces: { registerRoot: async () => undefined, isPathApproved: async () => true },
  })
  // The parent is intentionally absent; no file or directory is created.
  const uri = pathToFileURL(resolve('.codex-out/tmp', randomUUID(), 'missing.txt')).href
  await expectDeclaredFailure(
    surface,
    'filesystem.writeFileText',
    { uri, content: '' },
    'filesystem.write_file_text_failed',
  )
})
