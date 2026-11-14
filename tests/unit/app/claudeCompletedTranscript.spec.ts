// @vitest-environment node
import { expect, it } from 'vitest'
import { capturedClearFixture } from './claudeClearTranscript.helpers'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'

const user = {
  type: 'user',
  uuid: 'u',
  promptId: 'p',
  promptSource: 'typed',
  message: { content: 'work' },
}
const thinking = (parentUuid: string, uuid = 't') => ({
  type: 'assistant',
  uuid,
  parentUuid,
  message: { content: [{ type: 'thinking', thinking: 'thinking' }], stop_reason: null },
})
const final = (parentUuid: string) => ({
  type: 'assistant',
  uuid: 'f',
  parentUuid,
  message: { content: [{ type: 'text', text: 'REPLY_B' }], stop_reason: 'end_turn' },
})
it('requires an authenticated completion even when the file contains a final reply', async () => {
  const f = await capturedClearFixture(true)
  try {
    await f.hook('UserPromptSubmit', 'p')
    await f.append(JSON.stringify(user))
    await f.append(JSON.stringify(thinking('u')))
    await f.append(JSON.stringify(final('t')))
    expect((await f.probe()).writes).toBe(0)
  } finally {
    await f.close()
  }
})
it('does not discharge unrelated input between thinking and the matching final boundary', async () => {
  const f = await capturedClearFixture(true)
  try {
    await f.hook('UserPromptSubmit', 'p')
    await f.hook('Stop', 'p')
    await f.append(JSON.stringify(user))
    await f.append(JSON.stringify(thinking('u')))
    await f.append(
      JSON.stringify({
        type: 'user',
        origin: { kind: 'human' },
        parentUuid: 't',
        message: { content: 'new input' },
      }),
    )
    await f.append(JSON.stringify(final('t')))
    expect(f.fence().conversationQuarantined).toBe(true)
    expect((await f.probe()).writes).toBe(0)
  } finally {
    await f.close()
  }
})
it.each(
  [false, true].flatMap(stopFirst =>
    [false, true].map(withThinking => ({ stopFirst, withThinking })),
  ),
)(
  'accepts its completed prefix, Stop first=$stopFirst, thinking=$withThinking',
  async ({ stopFirst, withThinking }) => {
    const f = await capturedClearFixture(true)
    try {
      await f.hook('UserPromptSubmit', 'p')
      const turnId = f.fence().snapshot.turn!.id
      if (stopFirst) {
        await f.hook('Stop', 'p')
      }
      const before = f.fence().snapshot.lastEndedTurn
      for (const record of [
        user,
        ...(withThinking ? [thinking('u')] : []),
        final(withThinking ? 't' : 'u'),
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- file order is the evidence under test
        await f.append(JSON.stringify(record))
      }
      if (!stopFirst) {
        await f.hook('Stop', 'p')
      }
      const ended = f.fence().snapshot.lastEndedTurn
      expect(f.fence().snapshot).toMatchObject({
        state: 'idle',
        lastEndedTurn: { id: turnId, outcome: 'completed' },
      })
      if (stopFirst) {
        expect(ended).toEqual(before)
      }
      expect(f.registry.finalMessage({ nodeId: 'n', turnId: ended!.id })).toMatchObject({
        turnId: ended!.id,
        outcome: 'completed',
        message: 'REPLY_B',
      })
      expect(f.registry.promptIdentity(f.fence())).toMatchObject({ providerSessionId: f.capture.b })
      expect(f.fence().conversationQuarantined).toBe(false)
      expect(
        promptAdmission(f.fence(), () => ({ supported: true, submitDelayMs: 300 }), 'refuse'),
      ).toBeNull()
      expect((await f.probe()).writes).toBe(2)
    } finally {
      await f.close()
    }
  },
)
it.each(
  [false, true].flatMap(stopFirst =>
    ['q', 'p', undefined].map(promptId => ({ stopFirst, promptId })),
  ),
)(
  'refuses post-final thinking, Stop first=$stopFirst, explicit prompt=$promptId',
  async ({ stopFirst, promptId }) => {
    const f = await capturedClearFixture(true)
    try {
      await f.hook('UserPromptSubmit', 'p')
      if (stopFirst) {
        await f.hook('Stop', 'p')
      }
      for (const record of [user, thinking('u'), final('t')]) {
        // oxlint-disable-next-line no-await-in-loop -- file order is the evidence under test
        await f.append(JSON.stringify(record))
      }
      if (stopFirst) {
        expect(f.fence().conversationQuarantined).toBe(false)
      }
      await f.append(
        JSON.stringify({ ...thinking('f', 'late'), ...(promptId ? { promptId } : {}) }),
      )
      if (!stopFirst) {
        await f.hook('Stop', 'p')
      }
      const fence = f.fence()
      const delivery = await f.probe()
      expect({ quarantined: fence.conversationQuarantined, writes: delivery.writes }).toEqual({
        quarantined: true,
        writes: 0,
      })
      expect(delivery.result).toMatchObject({ code: 'agent.state_unknown' })
      expect(fence.snapshot).toMatchObject({
        state: 'idle',
        lastEndedTurn: { outcome: 'completed' },
      })
    } finally {
      await f.close()
    }
  },
)

it.each(['q', undefined])(
  'does not use delayed Stop arrival to discharge uncompleted thinking, explicit prompt=%s',
  async promptId => {
    const f = await capturedClearFixture(true)
    try {
      await f.hook('UserPromptSubmit', 'p')
      await f.append(
        JSON.stringify({ ...thinking('unattributed'), ...(promptId ? { promptId } : {}) }),
      )
      await f.hook('Stop', 'p')
      const quarantined = f.fence().conversationQuarantined
      expect({ quarantined, writes: (await f.probe()).writes }).toEqual({
        quarantined: true,
        writes: 0,
      })
    } finally {
      await f.close()
    }
  },
)
