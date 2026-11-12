// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../src/app/cli/core/run'
import { identityFixture } from '../unit/app/cliIdentity.helpers'
import { createControlSurface } from '../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { createControlSurfaceHttpServerContext } from '../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import type { WorkerTopologyStore } from '../../src/app/main/controlSurface/topology/topologyStore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

async function fixture(transient = false) {
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(createMinimalState('/repo', 'p', 's'))
  const ctx = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  const listMounts = vi.fn(async () => ({ mounts: [] }))
  const surface = createControlSurface()
  registerNodeControlHandlers(surface, {
    getPersistenceStore: async () => store,
    topology: {
      listEndpoints: async () => ({
        endpoints: [
          {
            endpointId: 'local',
            kind: 'local',
            displayName: 'Known Worker',
            remote: null,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
      listMounts,
    } as unknown as WorkerTopologyStore,
  })
  const f = identityFixture(false)
  let refused = false
  f.io.fetch = async (_url, init) => {
    if (transient && !refused) {
      refused = true
      throw new TypeError('arbitrary text', { cause: { code: 'ECONNREFUSED' } })
    }
    return new Response(JSON.stringify(await surface.invoke(ctx, JSON.parse(String(init?.body)))))
  }
  return { ...f, listMounts }
}

it.each([
  ['--path', '/repo'],
  ['--branch', 'main'],
])(
  'marks an unknown Worker non-retryable through the real locator and CLI: %s',
  async (flag, value) => {
    const f = await fixture()
    expect(await run(['node', 'list', '--worker', 'typo-worker', flag, value], f.io)).toBe(1)
    expect(f.out()).toBe('')
    expect(f.error()).toMatchObject({
      code: 'worker.unavailable',
      retryable: false,
      details: { reason: 'worker_not_found', worker: 'typo-worker' },
    })
    expect(f.listMounts).not.toHaveBeenCalled()
  },
)

it('keeps transient Worker failure retryable and succeeds when the unchanged read is repeated', async () => {
  const f = await fixture(true)
  const args = ['node', 'list', '--worker', 'Known Worker', '--path', '/repo']
  expect(await run(args, f.io)).toBe(3)
  expect(f.error()).toMatchObject({
    code: 'context.unreachable',
    retryable: true,
    details: { reason: 'connection_refused' },
  })
  expect(await run(args, f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({ projectId: 'p', spaceId: 's', nodes: [] })
})
