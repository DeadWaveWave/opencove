import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

const tempPaths: string[] = []

async function createSubject() {
  const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-topology-update-'))
  tempPaths.push(userDataPath)
  const disposeManagedSshEndpointRuntime = vi.fn(async () => undefined)
  return {
    userDataPath,
    disposeManagedSshEndpointRuntime,
    store: createWorkerTopologyStore({ userDataPath, disposeManagedSshEndpointRuntime }),
  }
}

describe('WorkerTopologyStore managed SSH update', () => {
  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map(async path => await rm(path, { recursive: true })))
  })

  it('preserves endpoint, credential, and mount identity while replacing configuration', async () => {
    const { userDataPath, store, disposeManagedSshEndpointRuntime } = await createSubject()
    const registered = await store.registerManagedSshEndpoint({
      displayName: 'Old box',
      host: 'old.example.com',
      port: 22,
      username: 'ubuntu',
      remotePort: 41_000,
    })
    const createdMount = await store.createMount({
      projectId: 'project-a',
      endpointId: registered.endpoint.endpointId,
      rootPath: '/remote/project',
    })
    const beforeTopology = JSON.parse(
      await readFile(join(userDataPath, 'worker-topology.json'), 'utf8'),
    ) as { endpoints: Array<{ credentialRef: string }> }
    const beforeSecrets = await readFile(join(userDataPath, 'worker-endpoint-secrets.json'), 'utf8')

    const result = await store.updateManagedSshEndpoint({
      endpointId: registered.endpoint.endpointId,
      displayName: 'New box',
      host: 'new.example.com',
      port: 2222,
      username: 'builder',
      remotePort: 42_000,
      remotePlatform: 'posix',
    })

    const afterTopology = JSON.parse(
      await readFile(join(userDataPath, 'worker-topology.json'), 'utf8'),
    ) as {
      endpoints: Array<{ endpointId: string; credentialRef: string }>
      mounts: Array<{ mountId: string; endpointId: string }>
    }
    expect(result.endpoint).toMatchObject({
      endpointId: registered.endpoint.endpointId,
      displayName: 'New box',
      access: {
        managedSsh: {
          host: 'new.example.com',
          port: 2222,
          username: 'builder',
          remotePort: 42_000,
          remotePlatform: 'posix',
        },
      },
    })
    expect(afterTopology.endpoints[0]?.credentialRef).toBe(
      beforeTopology.endpoints[0]?.credentialRef,
    )
    expect(afterTopology.mounts).toContainEqual(
      expect.objectContaining({
        mountId: createdMount.mount.mountId,
        endpointId: registered.endpoint.endpointId,
      }),
    )
    await expect(
      readFile(join(userDataPath, 'worker-endpoint-secrets.json'), 'utf8'),
    ).resolves.toBe(beforeSecrets)
    expect(disposeManagedSshEndpointRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: registered.endpoint.endpointId,
        ssh: expect.objectContaining({ host: 'old.example.com' }),
      }),
    )
  })

  it('preserves a mount created while the previous tunnel is being disposed', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-topology-update-race-'))
    tempPaths.push(userDataPath)
    let markDisposeStarted: () => void = () => undefined
    let releaseDispose: () => void = () => undefined
    const disposeStarted = new Promise<void>(resolve => {
      markDisposeStarted = resolve
    })
    const disposeGate = new Promise<void>(resolve => {
      releaseDispose = resolve
    })
    const store = createWorkerTopologyStore({
      userDataPath,
      disposeManagedSshEndpointRuntime: async () => {
        markDisposeStarted()
        await disposeGate
      },
    })
    const registered = await store.registerManagedSshEndpoint({
      host: 'old.example.com',
      remotePort: 41_000,
    })

    const updating = store.updateManagedSshEndpoint({
      endpointId: registered.endpoint.endpointId,
      host: 'new.example.com',
      remotePort: 42_000,
    })
    await disposeStarted
    const createdMount = await store.createMount({
      projectId: 'project-a',
      endpointId: registered.endpoint.endpointId,
      rootPath: '/remote/project',
    })
    releaseDispose()
    await updating

    const listed = await store.listMounts({ projectId: 'project-a' })
    expect(listed.mounts).toContainEqual(
      expect.objectContaining({ mountId: createdMount.mount.mountId }),
    )
    const durableTopology = JSON.parse(
      await readFile(join(userDataPath, 'worker-topology.json'), 'utf8'),
    ) as { mounts: Array<{ mountId: string }> }
    expect(durableTopology.mounts).toContainEqual(
      expect.objectContaining({ mountId: createdMount.mount.mountId }),
    )
  })

  it('fails cleanly when the endpoint is removed during runtime disposal', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-topology-update-removed-'))
    tempPaths.push(userDataPath)
    let markDisposeStarted: () => void = () => undefined
    let releaseDispose: () => void = () => undefined
    const disposeStarted = new Promise<void>(resolve => {
      markDisposeStarted = resolve
    })
    const disposeGate = new Promise<void>(resolve => {
      releaseDispose = resolve
    })
    let disposeCallCount = 0
    const store = createWorkerTopologyStore({
      userDataPath,
      disposeManagedSshEndpointRuntime: async () => {
        disposeCallCount += 1
        if (disposeCallCount === 1) {
          markDisposeStarted()
          await disposeGate
        }
      },
    })
    const registered = await store.registerManagedSshEndpoint({
      host: 'old.example.com',
      remotePort: 41_000,
    })

    const updating = store.updateManagedSshEndpoint({
      endpointId: registered.endpoint.endpointId,
      host: 'new.example.com',
      remotePort: 42_000,
    })
    await disposeStarted
    await store.removeEndpoint({ endpointId: registered.endpoint.endpointId })
    releaseDispose()

    await expect(updating).rejects.toMatchObject({ code: 'common.invalid_input' })
    const durableTopology = JSON.parse(
      await readFile(join(userDataPath, 'worker-topology.json'), 'utf8'),
    ) as { endpoints: Array<{ endpointId: string }> }
    expect(durableTopology.endpoints).not.toContainEqual(
      expect.objectContaining({ endpointId: registered.endpoint.endpointId }),
    )
  })

  it('leaves the durable topology byte-for-byte unchanged when validation fails', async () => {
    const { userDataPath, store, disposeManagedSshEndpointRuntime } = await createSubject()
    const registered = await store.registerManagedSshEndpoint({
      host: 'old.example.com',
      remotePort: 41_000,
    })
    const topologyPath = join(userDataPath, 'worker-topology.json')
    const before = await readFile(topologyPath, 'utf8')

    await expect(
      store.updateManagedSshEndpoint({
        endpointId: registered.endpoint.endpointId,
        host: 'new.example.com',
        remotePort: 0,
      }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })

    await expect(readFile(topologyPath, 'utf8')).resolves.toBe(before)
    expect(disposeManagedSshEndpointRuntime).not.toHaveBeenCalled()
  })

  it('leaves the durable topology unchanged when old-tunnel disposal fails', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'opencove-topology-update-dispose-'))
    tempPaths.push(userDataPath)
    const store = createWorkerTopologyStore({
      userDataPath,
      disposeManagedSshEndpointRuntime: async () => {
        throw new Error('dispose failed')
      },
    })
    const registered = await store.registerManagedSshEndpoint({
      host: 'old.example.com',
      remotePort: 41_000,
    })
    const topologyPath = join(userDataPath, 'worker-topology.json')
    const before = await readFile(topologyPath, 'utf8')

    await expect(
      store.updateManagedSshEndpoint({
        endpointId: registered.endpoint.endpointId,
        host: 'new.example.com',
        remotePort: 42_000,
      }),
    ).rejects.toThrow('dispose failed')

    await expect(readFile(topologyPath, 'utf8')).resolves.toBe(before)
  })
})
