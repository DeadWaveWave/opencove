import { describe, expect, it } from 'vitest'
import {
  buildManagedSshDraft,
  createEmptyEndpointFormDraft,
  isEndpointFormDirty,
  type EndpointFormDraft,
} from '../../../src/contexts/topology/domain/endpointFormDraft'

describe('endpoint form draft', () => {
  it('builds the managed SSH edit draft without losing optional-value semantics', () => {
    expect(
      buildManagedSshDraft({
        displayName: 'Build box',
        host: 'build.example.com',
        port: null,
        username: null,
        remotePort: 39_291,
      }),
    ).toEqual({
      registerMode: 'managed',
      displayName: 'Build box',
      managedHost: 'build.example.com',
      managedPort: '',
      managedUsername: '',
      managedRemotePort: '39291',
      manualHostname: '',
      manualPort: '',
      manualToken: '',
    })
  })

  it('treats an unchanged draft as clean', () => {
    const baseline = createEmptyEndpointFormDraft()

    expect(isEndpointFormDirty({ ...baseline }, baseline)).toBe(false)
  })

  it.each<keyof EndpointFormDraft>([
    'registerMode',
    'displayName',
    'managedHost',
    'managedPort',
    'managedUsername',
    'managedRemotePort',
    'manualHostname',
    'manualPort',
    'manualToken',
  ])('treats a changed %s field as dirty', field => {
    const baseline = createEmptyEndpointFormDraft()
    const changedValue = field === 'registerMode' ? 'manual' : 'changed'
    const current = { ...baseline, [field]: changedValue } as EndpointFormDraft

    expect(isEndpointFormDirty(current, baseline)).toBe(true)
  })
})
