// @vitest-environment node
import { expect, it } from 'vitest'
import { identifyInitialTurn } from '../../../src/app/cli/core/agentInitialTurn'
import { waitAndReadTurn } from '../../../src/app/cli/core/agentTurnComposition'
import type { CommandContext } from '../../../src/app/cli/core/command'
import { registryWaitFixture } from './agentWaitRegistry.helpers'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'

it('identifies the created session’s retained first end after another session claims its node', async () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  const f = registryWaitFixture(false, false, archive)
  try {
    f.observe('working', 'start')
    f.observe('idle', 'completed')
    f.registry.register({
      sessionId: 'replacement',
      nodeId: 'n',
      incarnation: 'new',
      provider: 'codex',
    })
    expect(f.registry.get({ sessionId: 's' })).toMatchObject({
      nodeId: null,
      lastEndedTurn: { id: 't1' },
    })
    expect(await f.wait('t1')).toMatchObject({
      nodeId: 'n',
      sessionId: 's',
      turnId: 't1',
      outcome: 'completed',
      persisted: true,
    })
    const ctx = {
      options: {},
      io: { now: Date.now, fetch: f.fetch },
      invoke: f.query,
      connection: { endpoint: 'http://fake', token: 't' },
    } as unknown as CommandContext
    const turnId = await identifyInitialTurn(ctx, { nodeId: 'n', sessionId: 's' }, Date.now() + 250)
    expect(turnId).toBe('t1')
    expect(
      await waitAndReadTurn(ctx, { nodeId: 'n', sessionId: 's', turnId }, Date.now() + 250),
    ).toMatchObject({ turnId: 't1', outcome: 'completed' })
  } finally {
    f.registry.dispose()
    archive.dispose()
  }
})
