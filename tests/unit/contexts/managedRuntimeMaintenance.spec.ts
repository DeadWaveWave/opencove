import { describe, expect, it } from 'vitest'
import { ManagedRuntimeMaintenance } from '../../../src/contexts/topology/application/ManagedRuntimeMaintenance'

describe('managed runtime maintenance admission', () => {
  it('refuses an upgrade while accepted work or a live idle shell exists', () => {
    let idle = true
    const owner = new ManagedRuntimeMaintenance(() => idle)
    const leave = owner.enter()
    expect(owner.acquire('update')).toBe(false)
    leave()
    idle = false
    expect(owner.acquire('update')).toBe(false)
    idle = true
    expect(owner.acquire('update')).toBe(true)
    expect(() => owner.enter()).toThrow('maintenance')
  })

  it('fences stale cancellation and stop requests', () => {
    const owner = new ManagedRuntimeMaintenance(() => true)
    expect(owner.acquire('first')).toBe(true)
    owner.release('first')
    expect(owner.acquire('second')).toBe(true)
    expect(() => owner.release('first')).toThrow()
    expect(() => owner.commitStop('first')).toThrow()
    expect(owner.phase).toBe('maintenance')
    owner.commitStop('second')
    expect(() => owner.release('second')).toThrow()
  })

  it('holds candidate ingress closed until the recorded activation is acknowledged', () => {
    const owner = new ManagedRuntimeMaintenance(() => true, 'candidate')
    expect(() => owner.enter()).toThrow()
    expect(() => owner.activate('wrong')).toThrow()
    owner.activate('candidate')
    expect(owner.phase).toBe('active')
    expect(owner.enter()).toBeTypeOf('function')
  })
})
