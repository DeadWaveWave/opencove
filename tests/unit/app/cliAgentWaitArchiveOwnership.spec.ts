// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { registryWaitFixture } from './agentWaitRegistry.helpers'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'

it('keeps an exact wait pending for the launch node after rebinding until its turn ends', async () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  const f = registryWaitFixture(false, false, archive)
  f.observe('working', 'start')
  f.registry.bind('s', { nodeId: 'replacement' })
  expect(f.registry.get({ nodeId: 'n' })).toBeNull()
  let settled = false
  const pending = f.wait('t1').then(
    value => {
      settled = true
      return { value }
    },
    error => {
      settled = true
      return { error }
    },
  )
  try {
    await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalled())
    expect(settled).toBe(false)
    f.observe('idle', 'completed')
    expect(await pending).toMatchObject({
      value: {
        nodeId: 'n',
        sessionId: 's',
        turnId: 't1',
        outcome: 'completed',
        persisted: true,
        state: 'unknown',
      },
    })
  } finally {
    await pending
    f.registry.dispose()
    archive.dispose()
  }
})

it('keeps historical wait state unknown when an idle replacement owns the node', async () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  const f = registryWaitFixture(false, false, archive)
  try {
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.registry.observe('s', {
      incarnation: 'i',
      source: 'exit',
      sourceSequence: 1,
      observedAt: 200,
      state: 'exited',
    })
    f.registry.register({ sessionId: 'new', nodeId: 'n', incarnation: 'new', provider: 'codex' })
    f.registry.observe('new', {
      incarnation: 'new',
      source: 'codex_hook',
      sourceSequence: 1,
      observedAt: 201,
      state: 'idle',
    })
    expect(f.registry.get({ sessionId: 's' })?.state).toBe('exited')
    expect(f.registry.get({ nodeId: 'n' })).toMatchObject({ sessionId: 'new', state: 'idle' })
    expect(await f.wait('t1')).toMatchObject({
      nodeId: 'n',
      sessionId: 's',
      turnId: 't1',
      outcome: 'completed',
      persisted: true,
      state: 'unknown',
    })
  } finally {
    f.registry.dispose()
    archive.dispose()
  }
})
