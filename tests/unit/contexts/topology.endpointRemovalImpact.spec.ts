import { describe, expect, it } from 'vitest'
import {
  resolveEndpointRemovalImpact,
  resolveEndpointRemovalImpacts,
} from '../../../src/contexts/topology/domain/endpointRemovalImpact'

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

  it('resolves multiple endpoint impacts from one mount snapshot', () => {
    const impacts = resolveEndpointRemovalImpacts(
      ['endpoint-a', 'endpoint-b', 'endpoint-c'],
      [
        { mountId: 'mount-1', endpointId: 'endpoint-a' },
        { mountId: 'mount-2', endpointId: 'endpoint-b' },
        { mountId: 'mount-3', endpointId: 'endpoint-a' },
      ],
    )

    expect(Object.fromEntries(impacts)).toEqual({
      'endpoint-a': { mountIds: ['mount-1', 'mount-3'], mountCount: 2 },
      'endpoint-b': { mountIds: ['mount-2'], mountCount: 1 },
      'endpoint-c': { mountIds: [], mountCount: 0 },
    })
  })
})
