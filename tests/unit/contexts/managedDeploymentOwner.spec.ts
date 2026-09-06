import { describe, expect, it, vi } from 'vitest'
import { prepareManagedDeployment } from '../../../src/contexts/topology/application/prepareManagedDeployment'
import type {
  ManagedDeploymentPort,
  ManagedDeploymentRecord,
  ManagedRuntimeInstallation,
} from '../../../src/contexts/topology/application/ports/ManagedDeploymentPort'

const candidate: ManagedRuntimeInstallation = {
  root: '/runtime/new',
  build: {
    schemaVersion: 1,
    buildId: 'a'.repeat(64),
    appVersion: '0.3.1',
    channel: 'stable',
    protocolVersion: 2,
    ptyProtocolVersion: 1,
    launchContractVersion: 1,
    dataSchemaVersion: 13,
  },
}
const old = {
  ...candidate,
  root: '/runtime/old',
  build: { ...candidate.build, appVersion: '0.3.0' },
}

function fixture() {
  let record: ManagedDeploymentRecord | null = null
  const port: ManagedDeploymentPort = {
    exclusive: async fn => await fn(),
    read: () => record,
    write: next => {
      record = { ...next }
    },
    observe: vi.fn(async () => null),
    maintenance: vi.fn(async () => true),
    waitStopped: vi.fn(async () => {}),
    snapshot: vi.fn(async () => '/snapshot'),
    start: vi.fn(async () => ({ instanceId: 'new', build: candidate.build, phase: 'candidate' })),
  }
  return { port, record: () => record }
}

describe('managed deployment transaction', () => {
  it('recovers a candidate whose start acknowledgement was lost without launching it again', async () => {
    const { port, record } = fixture()
    port.write({
      version: 1,
      revision: 1,
      operationId: 'interrupted',
      phase: 'starting',
      desired: candidate,
      active: null,
      previous: null,
      snapshot: '/snapshot',
      instanceId: null,
    })
    vi.mocked(port.observe).mockResolvedValue({
      instanceId: 'new',
      build: candidate.build,
      phase: 'candidate',
      activationId: 'interrupted',
    })
    await prepareManagedDeployment(port, candidate, 'retry')
    expect(record()?.phase).toBe('active')
    expect(port.start).not.toHaveBeenCalled()
    expect(port.maintenance).toHaveBeenCalledWith('activate', 'new', 'interrupted')
  })

  it('refuses a previously superseded development build from another client', async () => {
    const { port } = fixture()
    const active = { ...candidate, build: { ...candidate.build, channel: 'dev' as const } }
    const obsolete = { ...active, build: { ...active.build, buildId: 'b'.repeat(64) } }
    port.write({
      version: 1,
      revision: 1,
      operationId: 'previous',
      phase: 'active',
      desired: active,
      active,
      previous: obsolete,
      snapshot: null,
      instanceId: 'active',
      retiredBuildIds: [obsolete.build.buildId],
    })
    await expect(prepareManagedDeployment(port, obsolete, 'op')).rejects.toThrow(
      'client_update_required',
    )
    expect(port.start).not.toHaveBeenCalled()
  })

  it('commits the active version before allowing business writes', async () => {
    const { port, record } = fixture()
    vi.mocked(port.maintenance).mockImplementation(async action => {
      if (action === 'activate') {
        expect(record()?.phase).toBe('active')
      }
      return true
    })
    await prepareManagedDeployment(port, candidate, 'op')
    expect(record()?.active).toEqual(candidate)
    expect(port.snapshot).toHaveBeenCalledBefore(vi.mocked(port.start))
  })

  it('prepares but never stops an instance with active work', async () => {
    const { port, record } = fixture()
    vi.mocked(port.observe).mockResolvedValue({
      instanceId: 'old',
      build: old.build,
      phase: 'active',
    })
    vi.mocked(port.maintenance).mockResolvedValue(false)
    await expect(prepareManagedDeployment(port, candidate, 'op')).rejects.toThrow('runtime_busy')
    expect(record()?.phase).toBe('prepared')
    expect(port.start).not.toHaveBeenCalled()
    expect(port.snapshot).not.toHaveBeenCalled()
    expect(port.maintenance).toHaveBeenCalledTimes(1)
  })

  it('preserves the snapshot and blocks blind rollback after a candidate fails', async () => {
    const { port, record } = fixture()
    vi.mocked(port.start).mockRejectedValue(new Error('migration failed'))
    await expect(prepareManagedDeployment(port, candidate, 'op')).rejects.toThrow(
      'migration failed',
    )
    expect(record()?.phase).toBe('recovery_required')
    expect(record()?.snapshot).toBe('/snapshot')
    await expect(prepareManagedDeployment(port, candidate, 'retry')).rejects.toThrow(
      'recovery_required',
    )
    expect(port.start).toHaveBeenCalledTimes(1)
  })

  it('does not downgrade a newer durable deployment even when its process is stopped', async () => {
    const { port } = fixture()
    port.write({
      version: 1,
      revision: 1,
      operationId: 'previous',
      phase: 'active',
      desired: candidate,
      active: { ...candidate, build: { ...candidate.build, appVersion: '0.4.0' } },
      previous: null,
      snapshot: null,
      instanceId: 'previous',
    })
    await expect(prepareManagedDeployment(port, candidate, 'op')).rejects.toThrow(
      'client_update_required',
    )
    expect(port.start).not.toHaveBeenCalled()
  })
})
