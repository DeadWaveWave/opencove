import { describe, expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'

describe('agent binding filter invalidation', () => {
  it.each(['live', 'replay'] as const)(
    'invalidates old Space/project/node filters during %s delivery',
    mode => {
      const registry = new AgentRunStateRegistry({
        epoch: 'e',
        now: () => 1,
        createTurnId: () => 't',
        schedule: () => () => {},
      })
      registry.register({
        sessionId: 's',
        nodeId: 'n',
        provider: 'codex',
        incarnation: 'i',
        projectId: 'p',
        spaceId: 'a',
      })
      const watermark = registry.list({ spaceId: 'a' })
      const cursor = { epoch: watermark.epoch, afterSeq: watermark.seq }
      const oldSpace = vi.fn(),
        oldProject = vi.fn(),
        oldNode = vi.fn(),
        nextSpace = vi.fn(),
        all = vi.fn()
      const subscribe = () => {
        registry.subscribe(cursor, { spaceId: 'a', types: ['agent.turn_completed'] }, oldSpace)
        registry.subscribe(cursor, { projectId: 'p' }, oldProject)
        registry.subscribe(cursor, { nodeId: 'n' }, oldNode)
        registry.subscribe(cursor, { spaceId: 'b' }, nextSpace)
        registry.subscribe(cursor, {}, all)
      }
      if (mode === 'live') {
        subscribe()
      }
      registry.bind('s', { nodeId: null, projectId: 'q', spaceId: 'b' })
      if (mode === 'replay') {
        subscribe()
      }
      for (const listener of [oldSpace, oldProject, oldNode]) {
        expect(listener).toHaveBeenCalledExactlyOnceWith({
          type: 'resync_required',
          epoch: 'e',
          seq: 2,
          query: 'agent.list',
        })
      }
      expect(nextSpace).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: 'agent.state_changed',
          snapshot: expect.objectContaining({ nodeId: null }),
        }),
      )
      expect(all).toHaveBeenCalledTimes(1)
      expect(registry.list({ spaceId: 'a' }).agents).toEqual([])
      registry.dispose()
    },
  )
})
