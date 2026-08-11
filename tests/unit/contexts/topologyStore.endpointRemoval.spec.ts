import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

const tempPaths: string[] = []

async function createSubject() {
  const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-topology-remove-'))
  tempPaths.push(userDataPath)
  return createWorkerTopologyStore({ userDataPath })
}

describe('WorkerTopologyStore endpoint removal impact', () => {
  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map(async path => await rm(path, { recursive: true })))
  })

  it('unbinds exactly the mount count accepted by the confirmation snapshot', async () => {
    const store = await createSubject()
    const { endpoint } = await store.registerManagedSshEndpoint({
      host: 'example.com',
      port: 22,
      username: 'ubuntu',
      remotePort: 41_000,
    })
    await store.createMount({
      projectId: 'project-a',
      endpointId: endpoint.endpointId,
      rootPath: '/remote/a',
    })
    await store.createMount({
      projectId: 'project-b',
      endpointId: endpoint.endpointId,
      rootPath: '/remote/b',
    })

    const impact = await store.getEndpointRemovalImpact(endpoint.endpointId)
    const result = await store.removeEndpoint({
      endpointId: endpoint.endpointId,
      expectedMountCount: impact.mountCount,
    })

    expect(impact.mountCount).toBe(2)
    expect(result.removedMountCount).toBe(2)
    await expect(store.listMounts({ projectId: 'project-a' })).resolves.toMatchObject({ mounts: [] })
    await expect(store.listMounts({ projectId: 'project-b' })).resolves.toMatchObject({ mounts: [] })
  })

  it('fails closed when mount bindings changed after the displayed snapshot', async () => {
    const store = await createSubject()
    const { endpoint } = await store.registerManagedSshEndpoint({
      host: 'example.com',
      remotePort: 41_000,
    })
    const impact = await store.getEndpointRemovalImpact(endpoint.endpointId)
    await store.createMount({
      projectId: 'project-a',
      endpointId: endpoint.endpointId,
      rootPath: '/remote/a',
    })

    await expect(
      store.removeEndpoint({
        endpointId: endpoint.endpointId,
        expectedMountCount: impact.mountCount,
      }),
    ).rejects.toMatchObject({
      debugMessage: 'Endpoint mount bindings changed. Refresh before removing the endpoint.',
    })

    await expect(store.listEndpoints()).resolves.toMatchObject({
      endpoints: expect.arrayContaining([expect.objectContaining({ endpointId: endpoint.endpointId })]),
    })
    await expect(store.listMounts({ projectId: 'project-a' })).resolves.toMatchObject({
      mounts: [expect.objectContaining({ endpointId: endpoint.endpointId })],
    })
  })
})
