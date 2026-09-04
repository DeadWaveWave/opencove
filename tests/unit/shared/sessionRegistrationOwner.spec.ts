import {
  SessionRegistrationOwner,
  type SessionRegistrationDisposition,
} from '@shared/runtime/sessionRegistrationOwner'

describe('SessionRegistrationOwner', () => {
  it('rejects only the exact session that completed across its registration gap', () => {
    const owner = new SessionRegistrationOwner()
    const first = owner.begin()
    const second = owner.begin()

    owner.noteCompletion('session-second')

    expect(first.complete('session-first')).toBe<SessionRegistrationDisposition>('active')
    expect(second.complete('session-second')).toBe<SessionRegistrationDisposition>('completed')
  })

  it('retires active ownership without poisoning a later registration', () => {
    const owner = new SessionRegistrationOwner()
    expect(owner.begin().complete('session-reused')).toBe('active')
    owner.noteCompletion('session-reused')

    expect(owner.begin().complete('session-reused')).toBe('active')
  })

  it('fences a pending registration when its owner is disposed', () => {
    const owner = new SessionRegistrationOwner()
    const pending = owner.begin()

    owner.dispose()

    expect(pending.complete('session-late')).toBe('owner_disposed')
    expect(() => owner.begin()).toThrow('registration owner is disposed')
  })
})
