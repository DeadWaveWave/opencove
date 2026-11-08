import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_ATTENTION_COALESCE_MS,
  AGENT_ATTENTION_REWORK_DEBOUNCE_MS,
  createAgentAttentionRouter,
  type AgentAttentionChannels,
  type AgentAttentionEffect,
} from './agentAttentionRouter'

type Item = { sessionId: string }

function setup(channels: AgentAttentionChannels = { inApp: true, system: true, sound: true }) {
  const effects: AgentAttentionEffect<Item>[] = []
  let nextId = 0
  const current = { channels }
  const router = createAgentAttentionRouter<Item>({
    channels: () => current.channels,
    emit: effect => effects.push(effect),
    createId: () => `n${(nextId += 1)}`,
  })
  const kinds = () => effects.map(effect => effect.kind)
  return { router, effects, kinds, current }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('agent attention router', () => {
  it.each([
    [{ inApp: true, system: true, sound: true }, ['show-card', 'play-sound', 'system']],
    [{ inApp: true, system: false, sound: true }, ['show-card', 'play-sound']],
    [{ inApp: false, system: true, sound: true }, ['play-sound', 'system']],
    [{ inApp: true, system: true, sound: false }, ['show-card', 'system']],
    [{ inApp: false, system: false, sound: true }, ['play-sound']],
    [{ inApp: false, system: false, sound: false }, []],
  ] as const)('with %o, an Agent that needs you fires %o', (channels, expected) => {
    const { router, kinds } = setup(channels)
    router.needsYou({ sessionId: 'a' })
    vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
    expect(kinds()).toEqual(expected)
  })

  it('announces a waiting Agent once until it goes back to work', () => {
    const { router, kinds } = setup()
    router.needsYou({ sessionId: 'a' })
    vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
    router.needsYou({ sessionId: 'a' })
    vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
    expect(kinds()).toEqual(['show-card', 'play-sound', 'system'])
  })

  describe('coalescing', () => {
    it('folds Agents within 1.5s into one sound and one system notification', () => {
      const { router, effects, kinds } = setup()
      router.needsYou({ sessionId: 'a' })
      vi.advanceTimersByTime(500)
      router.needsYou({ sessionId: 'b' })
      vi.advanceTimersByTime(500)
      router.needsYou({ sessionId: 'c' })
      expect(kinds()).toEqual(['show-card', 'play-sound', 'system', 'show-card', 'show-card'])

      vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS - 1000)
      expect(kinds().filter(kind => kind === 'play-sound')).toHaveLength(1)
      // The first notification is replaced by one that counts all three.
      expect(effects.at(-1)).toEqual({
        kind: 'system',
        id: 'n2',
        items: [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }],
        replacesId: 'n1',
      })
    })

    it('keeps the first notification when nothing joins it', () => {
      const { router, effects } = setup()
      router.needsYou({ sessionId: 'a' })
      vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS * 2)
      expect(effects.filter(effect => effect.kind === 'system')).toEqual([
        { kind: 'system', id: 'n1', items: [{ sessionId: 'a' }], replacesId: null },
      ])
    })

    it('counts only the Agents still waiting when the window closes', () => {
      const { router, effects } = setup()
      router.needsYou({ sessionId: 'a' })
      router.needsYou({ sessionId: 'b' })
      router.working('a')
      vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
      expect(effects.at(-1)).toEqual({
        kind: 'system',
        id: 'n2',
        items: [{ sessionId: 'b' }],
        replacesId: 'n1',
      })
    })

    it('opens a new window, with its own sound, after 1.5s', () => {
      const { router, kinds } = setup()
      router.needsYou({ sessionId: 'a' })
      vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
      router.needsYou({ sessionId: 'b' })
      expect(kinds().filter(kind => kind === 'play-sound')).toHaveLength(2)
      expect(kinds().filter(kind => kind === 'system')).toHaveLength(2)
    })
  })

  describe('rework debounce', () => {
    it('does not announce again when the Agent works for less than 800ms', () => {
      const { router, kinds } = setup()
      router.needsYou({ sessionId: 'a' })
      vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
      router.working('a')
      vi.advanceTimersByTime(AGENT_ATTENTION_REWORK_DEBOUNCE_MS - 1)
      router.needsYou({ sessionId: 'a' })
      vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
      expect(kinds()).toEqual(['show-card', 'play-sound', 'system'])
    })

    it('clears the card after 800ms of work, and the next wait is announced', () => {
      const { router, kinds } = setup()
      router.needsYou({ sessionId: 'a' })
      vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
      router.working('a')
      expect(kinds()).not.toContain('clear-card')
      vi.advanceTimersByTime(AGENT_ATTENTION_REWORK_DEBOUNCE_MS)
      expect(kinds().at(-1)).toBe('clear-card')
      router.needsYou({ sessionId: 'a' })
      expect(kinds().slice(-3)).toEqual(['show-card', 'play-sound', 'system'])
    })

    it('ignores work from an Agent it never announced', () => {
      const { router, kinds } = setup()
      router.working('a')
      vi.advanceTimersByTime(AGENT_ATTENTION_REWORK_DEBOUNCE_MS)
      expect(kinds()).toEqual([])
    })
  })

  it('reads the switches when it fires, not when it was made', () => {
    const { router, kinds, current } = setup({ inApp: false, system: false, sound: false })
    current.channels = { inApp: false, system: false, sound: true }
    router.needsYou({ sessionId: 'a' })
    expect(kinds()).toEqual(['play-sound'])
  })

  it('stops its timers when disposed', () => {
    const { router, kinds } = setup()
    router.needsYou({ sessionId: 'a' })
    router.needsYou({ sessionId: 'b' })
    router.dispose()
    vi.advanceTimersByTime(AGENT_ATTENTION_COALESCE_MS)
    expect(kinds()).toEqual(['show-card', 'play-sound', 'system', 'show-card'])
  })
})
