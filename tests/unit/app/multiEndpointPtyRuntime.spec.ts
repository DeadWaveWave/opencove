import { describe, expect, it, vi } from 'vitest'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

function createRuntimeMock(
  overrides: Partial<ControlSurfacePtyRuntime> = {},
): ControlSurfacePtyRuntime {
  return {
    listProfiles: vi.fn(async () => ({
      profiles: [{ id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' }],
      defaultProfileId: 'powershell',
    })),
    spawnSession: vi.fn(async () => ({ sessionId: 'session-1' })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    ...overrides,
  }
}

describe('createMultiEndpointPtyRuntime', () => {
  it('forwards terminal profile discovery to the local runtime', async () => {
    const localRuntime = createRuntimeMock()
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime,
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
    })

    await expect(runtime.listProfiles?.()).resolves.toEqual({
      profiles: [{ id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' }],
      defaultProfileId: 'powershell',
    })
    expect(localRuntime.listProfiles).toHaveBeenCalledTimes(1)

    runtime.dispose()
  })
})
