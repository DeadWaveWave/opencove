// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { run } from '../../src/app/cli/core/run'
import { identityFixture } from '../unit/app/cliIdentity.helpers'
import { createControlSurface } from '../../src/app/main/controlSurface/controlSurface'
import { createControlSurfaceHttpServerContext } from '../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { registerTopologyHandlers } from '../../src/app/main/controlSurface/handlers/topologyHandlers'
import type { WorkerTopologyStore } from '../../src/app/main/controlSurface/topology/topologyStore'
import type { EndpointHealthService } from '../../src/app/main/controlSurface/topology/endpointHealthService'
import type { ApprovedWorkspaceStore } from '../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'

function fixture(known: boolean, connection = known) {
  const endpoint = {
    endpointId: 'remote',
    kind: 'remote_worker',
    displayName: 'Remote',
    remote: { hostname: 'remote', port: 1234 },
    createdAt: '',
    updatedAt: '',
  }
  const surface = createControlSurface()
  const ctx = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  registerTopologyHandlers(surface, {
    topology: {
      resolveRemoteEndpointConnection: async endpointId =>
        connection && endpointId === endpoint.endpointId
          ? { hostname: 'remote', port: 1234, token: 'remote-token' }
          : null,
      listEndpoints: async () => ({ endpoints: known ? [endpoint] : [] }),
    } as unknown as WorkerTopologyStore,
    approvedWorkspaces: {} as ApprovedWorkspaceStore,
    endpointHealth: {} as EndpointHealthService,
    readSshConfigHosts: async () => [],
  })
  const f = identityFixture(false)
  f.io.fetch = async (_url, init) =>
    new Response(JSON.stringify(await surface.invoke(ctx, JSON.parse(String(init?.body)))))
  return f
}
afterEach(() => vi.unstubAllGlobals())
it.each([false, true])(
  'does not retry endpoint ping for an unregistered endpoint ID (other endpoints=%s)',
  async known => {
    const f = fixture(known)
    expect(await run(['endpoint', 'ping', '--endpoint-id', 'typo-worker'], f.io)).toBe(1)
    expect(f.error()).toMatchObject({
      code: 'worker.unavailable',
      retryable: false,
      details: { reason: 'endpoint_not_found' },
    })
  },
)
it('keeps an unresolved registered endpoint non-retryable without transient evidence', async () => {
  const f = fixture(true, false)
  expect(await run(['endpoint', 'ping', '--endpoint-id', 'remote'], f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    retryable: false,
    details: { reason: 'endpoint_connection_unavailable' },
  })
})
it('retries a genuine endpoint connection refusal and succeeds with the same command', async () => {
  const remote = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('arbitrary words', { cause: { code: 'ECONNREFUSED' } }))
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { now: 'now', pid: 1 },
        }),
      ),
    )
  vi.stubGlobal('fetch', remote)
  const f = fixture(true)
  const args = ['endpoint', 'ping', '--endpoint-id', 'remote']
  expect(await run(args, f.io)).toBe(1)
  expect(f.error()).toMatchObject({
    code: 'worker.unavailable',
    retryable: true,
    details: { reason: 'connection_refused' },
  })
  expect(await run(args, f.io)).toBe(0)
  expect(JSON.parse(f.out()).ok).toBe(true)
})
it.each([
  [new SyntaxError('ECONNREFUSED in message only'), 'connection_failed'],
  [new TypeError('DNS failure', { cause: { code: 'ENOTFOUND' } }), 'connection_failed'],
])(
  'does not infer transient endpoint failure from wording or an unaudited errno',
  async (error, reason) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    const f = fixture(true)
    expect(await run(['endpoint', 'ping', '--endpoint-id', 'remote'], f.io)).toBe(1)
    expect(f.error()).toMatchObject({ retryable: false, details: { reason } })
  },
)
