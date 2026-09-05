// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ManagedSshEndpointPreparationRequest } from '../../../src/contexts/topology/application/ports/ManagedSshEndpointPreparationPort'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  invoke,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const { execute, snapshot } = vi.hoisted(() => ({ execute: vi.fn(), snapshot: vi.fn() }))
vi.mock('../../../src/app/main/controlSurface/topology/managedSshEndpointRuntime', () => ({
  createManagedSshEndpointRuntime: () => ({
    execute,
    getSnapshot: snapshot,
    resolveConnection: async () => null,
    disposeEndpoint: async () => undefined,
    dispose: async () => undefined,
  }),
}))

describe('Managed SSH accepted operations over HTTP', () => {
  it('returns before completion, joins across clients, monitors phases and fences removal/shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-ssh-http-operation-'))
    const requests: ManagedSshEndpointPreparationRequest[] = []
    execute.mockImplementation((request: ManagedSshEndpointPreparationRequest) => {
      requests.push(request)
      return new Promise(resolve => {
        request.signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), {
          once: true,
        })
      })
    })
    snapshot.mockReturnValue(null)
    const runtime = createControlSurfaceHttpRuntime({
      userDataPath: root,
      hostname: '127.0.0.1',
      port: 0,
      token: 'home-token',
      approvedWorkspaces: createApprovedWorkspaceStoreForPath(join(root, 'approved.json')),
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'unused' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })
    try {
      await runtime.ready
      const listener = runtime.listen({ hostname: '127.0.0.1', port: 0, role: 'private' })
      const address = await listener.ready
      const url = `http://${address.hostname}:${address.port}`
      const registered = await invoke(url, 'home-token', {
        kind: 'command',
        id: 'endpoint.registerManagedSsh',
        payload: { host: 'example.test' },
      })
      const endpointId = registered.data.value.endpoint.endpointId as string
      const prepare = { kind: 'command' as const, id: 'endpoint.prepare', payload: { endpointId } }
      const first = await invoke(url, 'home-token', prepare)
      const duplicate = await invoke(url, 'home-token', prepare)
      expect(first.data.value.overview.status).toBe('connecting')
      expect(duplicate.data.value.overview.operation.operationId).toBe(
        first.data.value.overview.operation.operationId,
      )
      expect(requests).toHaveLength(1)
      expect(first.data.value.overview.details).toEqual([])
      const conflict = await invoke(url, 'home-token', {
        kind: 'command',
        id: 'endpoint.repair',
        payload: { endpointId, action: 'update_runtime' },
      })
      expect(conflict.data).toMatchObject({
        ok: false,
        error: { code: 'endpoint.operation_in_progress' },
      })
      const request = requests[0]!
      request.reportPhase('installing_runtime')
      const observed = await invoke(url, 'home-token', {
        kind: 'query',
        id: 'endpoint.overview.list',
        payload: null,
      })
      const overview = observed.data.value.endpoints.find(
        (candidate: { endpoint: { endpointId: string } }) =>
          candidate.endpoint.endpointId === endpointId,
      )
      expect(overview.operation).toMatchObject({ revision: 2, phase: 'installing_runtime' })
      expect(JSON.stringify(observed.data)).not.toContain(request.access.token)
      const topology = await readFile(join(root, 'worker-topology.json'), 'utf8')
      expect(topology).not.toContain(request.operationId)
      const removed = await invoke(url, 'home-token', {
        kind: 'command',
        id: 'endpoint.remove',
        payload: { endpointId, expectedMountCount: 0 },
      })
      expect(removed.data.ok).toBe(true)
      expect(request.signal.aborted).toBe(true)
      request.reportPhase('verifying_connection')
      const again = await invoke(url, 'home-token', {
        kind: 'query',
        id: 'endpoint.overview.list',
        payload: null,
      })
      expect(again.data.value.endpoints).toHaveLength(1)
      const second = await invoke(url, 'home-token', {
        kind: 'command',
        id: 'endpoint.registerManagedSsh',
        payload: { host: 'second.test' },
      })
      await invoke(url, 'home-token', {
        ...prepare,
        payload: { endpointId: second.data.value.endpoint.endpointId },
      })
      runtime.beginShutdown()
      expect(requests[1]?.signal.aborted).toBe(true)
    } finally {
      await runtime.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
