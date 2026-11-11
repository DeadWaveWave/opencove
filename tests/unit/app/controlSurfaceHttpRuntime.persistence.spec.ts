// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, vi } from 'vitest'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { createAppError } from '../../../src/shared/errors/appError'
import { createInMemoryPersistenceStore } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import { context } from '../contexts/managedClaudeLaunchCompatibility.helpers'

it('keeps nonstrict startup available with spawn admission closed when ownership warmup cannot read storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencove-runtime-storage-'))
  const store = createInMemoryPersistenceStore()
  store.readAppState = async () => {
    throw createAppError('persistence.unavailable')
  }
  const spawn = vi.fn()
  const runtime = createControlSurfaceHttpRuntime({
    userDataPath: directory,
    token: 'fixture',
    createPersistenceStore: async () => store,
    ptyRuntime: {
      spawnSession: spawn,
      write: () => {},
      resize: vi.fn(),
      kill: () => {},
      onData: () => () => {},
      onExit: () => () => {},
    },
  })
  let invoke!: () => Promise<unknown>
  runtime.registerHandlers(surface => {
    invoke = () =>
      surface.invoke(context, {
        kind: 'command',
        id: 'pty.spawn',
        payload: {
          cwd: directory,
          cols: 80,
          rows: 24,
          command: '/bin/sh',
          args: [],
        },
      })
  })
  try {
    await expect(runtime.ready).resolves.toBeUndefined()
    expect(await invoke()).toMatchObject({
      ok: false,
      error: { code: 'terminal.runtime_not_ready' },
    })
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
