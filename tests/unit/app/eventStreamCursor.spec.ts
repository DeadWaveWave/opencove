// @vitest-environment node
import { expect, it } from 'vitest'
import {
  encodeEventCursor,
  decodeEventCursor,
  canonicalSelection,
} from '../../../src/shared/contracts/dto/eventStream'
it('canonicalizes type sets and retains the resolved selection in a bounded token', () => {
  const selection = canonicalSelection({
    types: ['agent.turn_completed', 'agent.state_changed', 'agent.turn_completed'],
    spaceId: 'deleted-space',
  })
  const cursor = { version: 1 as const, epoch: 'worker', seq: 7, selection }
  expect(decodeEventCursor(encodeEventCursor(cursor))).toEqual(cursor)
  expect(selection.types).toEqual(['agent.state_changed', 'agent.turn_completed'])
})
it.each(['bad', 'a'.repeat(17000), Buffer.from('{"version":2}').toString('base64url')])(
  'rejects malformed cursor %s',
  token => {
    expect(() => decodeEventCursor(token)).toThrow()
  },
)
