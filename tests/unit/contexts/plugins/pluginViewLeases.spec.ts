import { describe, expect, it, vi } from 'vitest'
import { PluginViewLeases } from '../../../../src/contexts/plugins/application/PluginViewLeases'

function create() {
  const scheduled = new Set<() => void>()
  const expired = vi.fn()
  const leases = new PluginViewLeases<{ label: string }>({
    scheduleExpiry: callback => {
      scheduled.add(callback)
      return () => scheduled.delete(callback)
    },
    onExpired: id => {
      expired(id)
      leases.remove(id)
    },
  })
  return {
    leases,
    scheduled,
    expired,
    expire: () => {
      for (const callback of [...scheduled]) {
        scheduled.delete(callback)
        callback()
      }
    },
  }
}

describe('plugin native connection leases', () => {
  it('reclaims abandoned opens and detached views while live streams never expire from UI inactivity', () => {
    const { leases, scheduled, expire, expired } = create()
    leases.add('view', 'token', { label: 'preview' })
    expect(scheduled.size).toBe(1)
    const retire = vi.fn()
    const detach = leases.attach('token', retire)!
    expect(scheduled.size).toBe(0)
    expire()
    expect(leases.get('view')).toEqual({ label: 'preview' })
    expect(expired).not.toHaveBeenCalled()
    detach()
    expect(scheduled.size).toBe(1)
    expire()
    expect(expired).toHaveBeenCalledWith('view')
    expect(leases.getByToken('token')).toBeUndefined()
    expect(retire).not.toHaveBeenCalled()
  })

  it('cancels disconnect grace on reconnect and closes all native connections on explicit revocation', () => {
    const { leases, scheduled, expired } = create()
    leases.add('view', 'token', { label: 'music' })
    const staleExpiry = [...scheduled][0]
    const releaseFirst = leases.attach('token', vi.fn())!
    releaseFirst()
    const releaseSecond = leases.attach('token', vi.fn())!
    staleExpiry()
    expect(expired).not.toHaveBeenCalled()
    const retireThird = vi.fn()
    leases.attach('token', retireThird)
    releaseSecond()
    expect(scheduled.size).toBe(0)
    leases.remove('view')
    expect(retireThird).toHaveBeenCalledTimes(1)
    expect(scheduled.size).toBe(0)
    expect(leases.attach('token', vi.fn())).toBeNull()
  })
})
