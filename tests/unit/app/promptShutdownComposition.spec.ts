// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as contextFactory from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createInMemoryPersistenceStore } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import { invokeCallerLifetime } from '../../../src/app/main/controlSurface/http/invokeCallerLifetime'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'

it.each(['queued', 'delay'] as const)(
  'production beginShutdown revokes %s bearer delivery before transport drain',
  async phase => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-prompt-shutdown-'))
    const spy = vi.spyOn(contextFactory, 'createControlSurfaceHttpServerContext')
    const worker = createControlSurfaceHttpRuntime({
      userDataPath: root,
      token: 'test',
      approvedWorkspaces: createApprovedWorkspaceStoreForPath(join(root, 'approved.json')),
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: () => () => {},
        onExit: () => () => {},
      },
    })
    const ctx = spy.mock.results.at(-1)!.value as ReturnType<
      typeof contextFactory.createControlSurfaceHttpServerContext
    >
    const caller = invokeCallerLifetime(ctx, new EventEmitter() as ServerResponse, {
      kind: 'bearer',
    })
    const f = promptDeliveryRuntimeFixture()
    let release!: () => void
    const queued =
      phase === 'queued'
        ? f.hub.withSessionInputOperation('s', async () => {
            await new Promise<void>(wake => {
              release = wake
            })
          })
        : Promise.resolve()
    try {
      await worker.ready
      if (phase === 'queued') {
        await Promise.resolve()
      }
      const result = f.deliver(caller)
      const assertion = expect(result).rejects.toHaveProperty(
        'code',
        phase === 'queued' ? 'agent.not_running' : 'agent.prompt_interrupted',
      )
      if (phase === 'delay') {
        await Promise.resolve()
      }
      worker.beginShutdown() // Real production path, without listening or a test-only signal.
      expect(ctx.signal?.aborted).toBe(true)
      expect(caller.signal.aborted).toBe(true)
      expect(ctx.assertActive).toThrow()
      if (phase === 'queued') {
        release()
        await queued
      }
      await assertion
      expect(f.write).toHaveBeenCalledTimes(phase === 'queued' ? 0 : 1)
    } finally {
      caller.dispose()
      f.dispose()
      await worker.dispose()
      spy.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  },
)
