import { describe, expect, it } from 'vitest'
import { resolveEndpointRemovalImpact } from '../../../src/contexts/topology/domain/endpointRemovalImpact'

describe('resolveEndpointRemovalImpact', () => {
  it('returns no impact when the endpoint has no mounts', () => {
    expect(resolveEndpointRemovalImpact('endpoint-a', [])).toEqual({ mountIds: [], mountCount: 0 })
  })

  it('returns only distinct mount bindings for the selected endpoint', () => {
    const mounts = [
      { mountId: 'mount-1', endpointId: 'endpoint-a' },
      { mountId: 'mount-1', endpointId: 'endpoint-a' },
      { mountId: 'mount-2', endpointId: 'endpoint-b' },
      { mountId: 'mount-3', endpointId: 'endpoint-a' },
    ] as const

    expect(resolveEndpointRemovalImpact('endpoint-a', mounts)).toEqual({
      mountIds: ['mount-1', 'mount-3'],
      mountCount: 2,
    })
  })
})
