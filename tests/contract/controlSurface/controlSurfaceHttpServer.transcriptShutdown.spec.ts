// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import * as contextFactory from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import * as finalMessage from '../../../src/app/main/controlSurface/handlers/sessionFinalMessageHandler'
import * as resolver from '../../../src/contexts/agent/infrastructure/watchers/SessionFileResolver'
import { resolveExecutionContextDto } from '../../../src/app/main/controlSurface/handlers/sessionLaunchSupport'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import {
  createMinimalState,
  invoke,
  safeRemoveDirectory,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describeWithElectronNativeModules('Transcript cancellation and durable shutdown', () => {
  it('aborts an accepted transcript query while retaining the accepted write in the real shutdown drain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-transcript-shutdown-'))
    const dbPath = join(root, 'state.db')
    const store = await createPersistenceStore({ dbPath })
    const writeStarted = deferred()
    const writeRelease = deferred()
    const lookupStarted = deferred()
    const contextSpy = vi.spyOn(contextFactory, 'createControlSurfaceHttpServerContext')
    const registrationSpy = vi.spyOn(finalMessage, 'registerSessionFinalMessageHandler')
    let lookupSettled = false
    const originalResolve = resolver.resolveSessionFilePath
    const lookupSpy = vi
      .spyOn(resolver, 'resolveSessionFilePath')
      .mockImplementation(async input => {
        lookupStarted.resolve()
        try {
          return await originalResolve(input)
        } finally {
          lookupSettled = true
        }
      })
    const worker = createControlSurfaceHttpRuntime({
      userDataPath: root,
      dbPath,
      token: 'test',
      approvedWorkspaces: createApprovedWorkspaceStoreForPath(join(root, 'approved.json')),
      createPersistenceStore: async () => ({
        ...store,
        writeAppState: async (...args) => {
          writeStarted.resolve()
          await writeRelease.promise
          return await store.writeAppState(...args)
        },
      }),
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: () => () => {},
        onExit: () => () => {},
      },
    })
    const ctx = contextSpy.mock.results.at(-1)!.value as ReturnType<
      typeof contextFactory.createControlSurfaceHttpServerContext
    >
    const sessions = registrationSpy.mock.calls.at(-1)![1].sessions
    sessions.set('s', {
      sessionId: 's',
      provider: 'claude-code',
      cwd: root,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      prompt: '',
      model: null,
      effectiveModel: null,
      command: 'claude',
      args: [],
      executionContext: resolveExecutionContextDto(root),
      route: { kind: 'local' },
      resumeSessionId: 'missing-transcript',
    })
    const listener = worker.listen({
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 0,
      role: 'private',
      enableWebShell: false,
      webUiPasswordHash: null,
    })
    const observe = (operation: ReturnType<typeof invoke>) =>
      operation.then(
        response => ({ response }),
        () => ({ response: null }),
      )
    let write: ReturnType<typeof observe> | undefined
    let query: ReturnType<typeof observe> | undefined
    try {
      await worker.ready
      const info = await listener.ready
      const url = `http://${info.hostname}:${info.port}`
      const state = createMinimalState(root, 'workspace', 'space')
      state.workspaces[0]!.name = 'durable-after-read-abort'
      write = observe(
        invoke(url, 'test', { kind: 'command', id: 'sync.writeState', payload: { state } }),
      )
      await writeStarted.promise
      query = observe(
        invoke(url, 'test', {
          kind: 'query',
          id: 'session.finalMessage',
          payload: { sessionId: 's' },
        }),
      )
      await lookupStarted.promise
      worker.beginShutdown()
      expect(ctx.signal?.aborted).toBe(true)
      // Release the transport first: the accepted-operation owner must still retain the write.
      const transportDrain = listener.stopAccepting({ drainTimeoutMs: 0 })
      let disposed = false
      const disposal = worker.dispose().then(() => {
        disposed = true
      })
      await transportDrain
      await expect.poll(() => lookupSettled, { timeout: 500, interval: 10 }).toBe(true)
      const response = (await query).response
      if (response) {
        expect(response.data).toMatchObject({ ok: false })
      }
      expect(disposed).toBe(false)
      writeRelease.resolve()
      await write
      await disposal
      const reopened = await createPersistenceStore({ dbPath })
      try {
        expect(await reopened.readAppState()).toMatchObject({
          workspaces: [{ name: 'durable-after-read-abort' }],
        })
      } finally {
        reopened.dispose()
      }
    } finally {
      writeRelease.resolve()
      await Promise.allSettled([write, query])
      await worker.dispose()
      lookupSpy.mockRestore()
      registrationSpy.mockRestore()
      contextSpy.mockRestore()
      await safeRemoveDirectory(root)
    }
  })
})
