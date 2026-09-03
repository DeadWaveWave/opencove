import { vi } from 'vitest'
import { PtyHostSessionEventOwner } from '../../../src/platform/process/ptyHost/ptyHostSessionEventOwner'

function createFixture() {
  const events: Array<{ type: 'data' | 'exit'; value: string | number }> = []
  const retireUnowned = vi.fn()
  const owner = new PtyHostSessionEventOwner({
    emitData: event => events.push({ type: 'data', value: event.data }),
    emitExit: event => events.push({ type: 'exit', value: event.exitCode }),
    retireUnowned,
  })
  return { owner, events, retireUnowned }
}

describe('PTY host session event owner', () => {
  it('flushes pre-response data before the exit completion boundary when spawn is accepted', () => {
    const { owner, events } = createFixture()

    owner.observeData({ sessionId: 'session-1', data: 'active ' })
    owner.observeData({ sessionId: 'session-1', data: 'writer' })
    owner.observeExit({ sessionId: 'session-1', exitCode: 1 })
    owner.resolveSpawn('session-1', true)

    expect(events).toEqual([
      { type: 'data', value: 'active ' },
      { type: 'data', value: 'writer' },
      { type: 'exit', value: 1 },
    ])
    expect(owner.has('session-1')).toBe(false)
  })

  it('clears owned sessions during intentional supervisor disposal without publishing exits', () => {
    const { owner, events } = createFixture()
    owner.resolveSpawn('session-1', true)

    owner.clear()

    expect(events).toEqual([])
    expect(owner.has('session-1')).toBe(false)
  })

  it('does not retire an already-owned session for a mismatched duplicate response', () => {
    const { owner, retireUnowned } = createFixture()
    owner.resolveSpawn('session-1', true)

    owner.resolveSpawn('session-1', false)

    expect(retireUnowned).not.toHaveBeenCalled()
    expect(owner.has('session-1')).toBe(true)
  })

  it('retires a late successful spawn that no longer has request ownership', () => {
    const { owner, events, retireUnowned } = createFixture()
    owner.observeData({ sessionId: 'late-session', data: 'unowned output' })

    owner.resolveSpawn('late-session', false)

    expect(events).toEqual([])
    expect(retireUnowned).toHaveBeenCalledWith('late-session')
    expect(owner.has('late-session')).toBe(false)

    owner.observeData({ sessionId: 'late-session', data: 'late output' })
    owner.observeExit({ sessionId: 'late-session', exitCode: 1 })
    expect(events).toEqual([])
  })
})
