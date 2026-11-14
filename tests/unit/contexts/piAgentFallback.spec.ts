import { describe, expect, it, vi } from 'vitest'
import { PiSessionObservationWatcher } from '../../../src/contexts/agent/infrastructure/watchers/PiSessionObservationWatcher'
import { PiSessionStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/PiSessionStateWatcher'
import type { PiAgentSnapshot } from '../../../src/shared/contracts/dto/piAgentSnapshot'

const snapshot: PiAgentSnapshot = {
  version: 1,
  pid: 12,
  sequence: 1,
  conversationRevision: 1,
  sessionId: 'a',
  sessionFile: '/custom/a.jsonl',
  persistence: 'resumable',
  state: 'working',
}

describe('Pi conversation-scoped fallback', () => {
  it('rebinds only exact native paths and ignores old watcher callbacks after switch/disposal', () => {
    const onState = vi.fn()
    const callbacks: ConstructorParameters<typeof PiSessionStateWatcher>[0][] = []
    const disposals: ReturnType<typeof vi.fn>[] = []
    const owner = new PiSessionObservationWatcher({
      sessionId: 'pty',
      onState,
      createWatcher: options => {
        callbacks.push(options)
        const watcher = new PiSessionStateWatcher(options)
        vi.spyOn(watcher, 'start').mockImplementation(() => undefined)
        disposals.push(vi.spyOn(watcher, 'dispose'))
        return watcher
      },
    })
    owner.observe(snapshot)
    owner.observe({ ...snapshot, sequence: 2 })
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0].filePath).toBe('/custom/a.jsonl')
    owner.observe({
      ...snapshot,
      sequence: 3,
      conversationRevision: 2,
      sessionId: 'b',
      sessionFile: '/custom/b.jsonl',
      persistence: 'allocated',
    })
    callbacks[0].onState('pty', 'standby')
    expect(onState).not.toHaveBeenCalled()
    expect(disposals[0]).toHaveBeenCalledOnce()
    owner.observe({
      ...snapshot,
      sequence: 4,
      conversationRevision: 2,
      sessionId: 'b',
      sessionFile: '/custom/b.jsonl',
    })
    callbacks[1].onState('pty', 'working')
    expect(onState).toHaveBeenCalledWith(
      expect.objectContaining({ piConversation: { pid: 12, revision: 2 } }),
    )
    owner.dispose()
    callbacks[1].onState('pty', 'standby')
    expect(onState).toHaveBeenCalledTimes(1)
  })

  it('does not let a retired watcher invalidate its replacement in the same conversation', () => {
    const callbacks: ConstructorParameters<typeof PiSessionStateWatcher>[0][] = []
    const onState = vi.fn()
    const owner = new PiSessionObservationWatcher({
      sessionId: 'pty',
      onState,
      createWatcher: options => {
        callbacks.push(options)
        const watcher = new PiSessionStateWatcher(options)
        vi.spyOn(watcher, 'start').mockImplementation(() => undefined)
        return watcher
      },
    })
    owner.observe(snapshot)
    callbacks[0].onUnavailable?.()
    owner.observe({ ...snapshot, sequence: 2 })
    onState.mockClear()
    callbacks[0].onUnavailable?.()
    expect(onState).not.toHaveBeenCalled()
    callbacks[1].onState('pty', 'waiting')
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ state: 'waiting' }))
    owner.dispose()
  })
})
