import { describe, expect, it } from 'vitest'
import { createManagedSshEndpointRegistration } from '../../../src/app/main/controlSurface/topology/topologyEndpointRegistration'

describe('managed SSH endpoint registration', () => {
  it('allocates a non-default remote port when the form leaves the worker port blank', () => {
    const { record } = createManagedSshEndpointRegistration(
      {
        host: 'localhost',
        port: 22,
        username: 'root',
        remotePort: null,
        remotePlatform: 'auto',
      },
      [39291],
      '2026-05-17T00:00:00.000Z',
    )

    expect(record.managedSsh?.remotePort).toBeGreaterThanOrEqual(40_000)
    expect(record.managedSsh?.remotePort).toBeLessThanOrEqual(60_999)
    expect(record.managedSsh?.remotePort).not.toBe(39291)
  })

  it('preserves an explicit remote worker port for advanced setups', () => {
    const { record } = createManagedSshEndpointRegistration(
      {
        host: 'localhost',
        port: 22,
        username: 'root',
        remotePort: 39291,
        remotePlatform: 'auto',
      },
      [],
      '2026-05-17T00:00:00.000Z',
    )

    expect(record.managedSsh?.remotePort).toBe(39291)
  })
})
