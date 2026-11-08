// @vitest-environment node
import { expect, it } from 'vitest'
import { archivedSelectedTurn } from '../../../src/app/cli/core/agentWaitTurn'
import { CliError } from '../../../src/app/cli/core/errors'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

const metadata = {
  nodeId: node.id,
  sessionId: 's',
  turnId: 't',
  outcome: 'completed',
  deliveryIds: ['d1', 'd2'],
  promptIds: ['p1', 'p2'],
  promptId: 'p2',
}
it.each([false, true])(
  'turn wait identifiers: returns IDs without message text (message-free: %s)',
  async empty => {
    const result = await archivedSelectedTurn(node.id, 't', async () => {
      if (empty) {
        throw new CliError('agent.final_message_unavailable', 1, 'no text', undefined, {
          ...metadata,
          reason: 'provider_sent_no_message',
        })
      }
      return { ...metadata, message: 'private reply' }
    })
    expect(result).toMatchObject({
      deliveryIds: metadata.deliveryIds,
      promptIds: metadata.promptIds,
    })
    expect(result).not.toHaveProperty('message')
  },
)
it('turn read identifiers: IDs are projectable without changing the text default', async () => {
  const f = identityFixture(false)
  f.values['agent.finalMessage'] = {
    ...metadata,
    message: 'reply',
    source: 'hook',
    truncated: false,
  }
  expect(
    await run(
      [
        'agent',
        'read',
        '--node',
        node.id,
        '--turn',
        't',
        '--fields',
        'turnId,deliveryIds,promptIds,promptId',
      ],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    turnId: 't',
    deliveryIds: ['d1', 'd2'],
    promptIds: ['p1', 'p2'],
    promptId: 'p2',
  })
})

it.each(['turnArchive'])(
  'turn wait identifiers: CLI projects IDs from %s history without reply content',
  async capability => {
    const f = identityFixture(false)
    f.values['agent.list'] = { epoch: 'e', seq: 0, agents: [], [capability]: true }
    f.values['agent.get'] = null
    f.values['agent.finalMessage'] = { ...metadata, message: 'private reply', persisted: true }
    expect(
      await run(
        [
          'agent',
          'wait',
          '--node',
          node.id,
          '--turn',
          't',
          '--fields',
          'turnId,deliveryIds,promptIds',
        ],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toEqual({
      turnId: 't',
      deliveryIds: ['d1', 'd2'],
      promptIds: ['p1', 'p2'],
    })
    expect(f.out()).not.toContain('private reply')
  },
)
