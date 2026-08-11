import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEndpointHealthService } from '../../../src/app/main/controlSurface/topology/endpointHealthService'
import type { ManagedSshEndpointRuntime } from '../../../src/app/main/controlSurface/topology/managedSshEndpointRuntime'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { TopologyState } from '../../../src/app/main/controlSurface/topology/topologyPersistence'
import { createTopologyMutationQueue } from '../../../src/app/main/controlSurface/topology/topologyWriteQueue'

const tempPaths: string[] = []

async function createSubject(writeFileImpl?: typeof writeFile) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-topology-persistence-'))
  tempPaths.push(userDataPath)
  return {
    userDataPath,
    store: createWorkerTopologyStore({ userDataPath, writeFileImpl }),
  }
}

async function readDurableEndpointNames(userDataPath: string): Promise<string[]> {
  const topology = JSON.parse(
    await readFile(join(userDataPath, 'worker-topology.json'), 'utf8'),
  ) as { endpoints: Array<{ displayName: string }> }
  return topology.endpoints.map(endpoint => endpoint.displayName)
}

describe('WorkerTopologyStore persistence queue', () => {
  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map(async path => await rm(path, { recursive: true })))
  })

  it('keeps the queue usable after one persist fails', async () => {
    const { userDataPath, store } = await createSubject()
    await store.listEndpoints()
    const topologyPath = join(userDataPath, 'worker-topology.json')
    await mkdir(topologyPath)

    await expect(
      store.registerEndpoint({
        displayName: 'Failed endpoint',
        hostname: 'failed.example.com',
        port: 41_001,
        token: 'failed-token',
      }),
    ).rejects.toMatchObject({ code: 'persistence.io_failed' })

    await rm(topologyPath, { recursive: true })

    await expect(
      store.registerEndpoint({
        displayName: 'Saved endpoint',
        hostname: 'saved.example.com',
        port: 41_002,
        token: 'saved-token',
      }),
    ).resolves.toMatchObject({ endpoint: { displayName: 'Saved endpoint' } })

    await expect(readDurableEndpointNames(userDataPath)).resolves.toEqual(['Saved endpoint'])
    await expect(store.getPersistenceIssue?.()).resolves.toMatchObject({
      operation: 'endpoint.register',
      pendingCount: 1,
    })
  })

  it('preserves FIFO order when an early concurrent write fails', async () => {
    let topologyAttempts = 0
    const writeFileImpl: typeof writeFile = async (...args) => {
      if (String(args[0]).includes('worker-topology.json')) {
        topologyAttempts += 1
        if (topologyAttempts === 1) {
          throw new Error('injected topology write failure')
        }
      }

      return await writeFile(...args)
    }
    const { userDataPath, store } = await createSubject(writeFileImpl)
    await store.listEndpoints()

    const results = await Promise.allSettled([
      store.registerEndpoint({
        displayName: 'First',
        hostname: 'first.example.com',
        port: 41_001,
        token: 'first-token',
      }),
      store.registerEndpoint({
        displayName: 'Second',
        hostname: 'second.example.com',
        port: 41_002,
        token: 'second-token',
      }),
      store.registerEndpoint({
        displayName: 'Third',
        hostname: 'third.example.com',
        port: 41_003,
        token: 'third-token',
      }),
    ])

    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    await expect(readDurableEndpointNames(userDataPath)).resolves.toEqual(['Second', 'Third'])
    expect(topologyAttempts).toBe(3)
  })

  it('rolls memory back and exposes an explicit retry action until the failed write succeeds', async () => {
    const { userDataPath, store } = await createSubject()
    await store.listEndpoints()
    const topologyPath = join(userDataPath, 'worker-topology.json')
    await mkdir(topologyPath)

    await expect(
      store.registerEndpoint({
        displayName: 'Retry endpoint',
        hostname: 'retry.example.com',
        port: 41_001,
        token: 'retry-token',
      }),
    ).rejects.toMatchObject({ code: 'persistence.io_failed' })

    await rm(topologyPath, { recursive: true })

    await expect(store.listEndpoints()).resolves.toEqual({
      endpoints: [expect.objectContaining({ endpointId: 'local' })],
    })

    const health = createEndpointHealthService({
      topology: store,
      managedRuntime: {} as ManagedSshEndpointRuntime,
    })
    const failedOverview = (await health.listOverviews()).endpoints.find(
      overview => overview.endpoint.endpointId === 'local',
    )
    expect(failedOverview).toMatchObject({
      status: 'persistence_failed',
      recommendedAction: 'retry',
      canBrowse: false,
    })

    await expect(
      health.repairEndpoint({ endpointId: 'local', action: 'retry' }),
    ).resolves.toMatchObject({
      overview: {
        endpoint: { endpointId: 'local' },
        status: 'connected',
        recommendedAction: 'none',
      },
    })

    await expect(readDurableEndpointNames(userDataPath)).resolves.toEqual(['Retry endpoint'])
    await expect(store.listEndpoints()).resolves.toMatchObject({
      endpoints: [
        expect.objectContaining({ endpointId: 'local' }),
        expect.objectContaining({ displayName: 'Retry endpoint' }),
      ],
    })
  })
})

describe('topology mutation invariant', () => {
  it('restores the durable host when an update-like mutation fails, then reapplies it on retry', async () => {
    const durableState: TopologyState = {
      topology: {
        version: 1,
        endpoints: [
          {
            endpointId: 'managed-1',
            kind: 'remote_worker',
            displayName: 'Managed endpoint',
            hostname: '127.0.0.1',
            port: 41_000,
            credentialRef: 'credential-1',
            accessKind: 'managed_ssh',
            managedSsh: {
              host: 'old.example.com',
              port: 22,
              username: null,
              remotePort: 41_000,
              remotePlatform: 'auto',
            },
            createdAt: '2026-08-11T00:00:00.000Z',
            updatedAt: '2026-08-11T00:00:00.000Z',
          },
        ],
        mounts: [],
      },
      secrets: { version: 1, tokensByCredentialRef: { 'credential-1': 'token' } },
    }
    let committedState = durableState
    let shouldFail = true
    const queue = createTopologyMutationQueue({
      getCommittedState: () => committedState,
      replaceCommittedState: state => {
        committedState = state
      },
      readDurableState: async () => durableState,
      persist: async () => {
        if (shouldFail) {
          throw new Error('injected update failure')
        }
      },
    })

    await expect(
      queue.enqueue({
        operation: 'endpoint.updateManagedSsh',
        apply: draft => {
          const endpoint = draft.topology.endpoints[0]
          if (endpoint?.managedSsh) {
            endpoint.managedSsh.host = 'new.example.com'
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'persistence.io_failed' })
    expect(committedState.topology.endpoints[0]?.managedSsh?.host).toBe('old.example.com')

    shouldFail = false
    await queue.retryPersistence()
    expect(committedState.topology.endpoints[0]?.managedSsh?.host).toBe('new.example.com')
    expect(queue.getPersistenceIssue()).toBeNull()
  })
})
