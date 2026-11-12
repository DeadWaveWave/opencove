// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { completedPromptFixture } from './cliAgentPromptWait.helpers'
import { node } from './cliIdentity.helpers'

const waiting = `Waiting for turn t of node ${node.id}. If interrupted, continue with: opencove agent wait --node ${node.id} --turn t (do not resend).\n`
function fixture() {
  const f = completedPromptFixture()
  const messages: string[] = []
  const write = f.io.stderr.write
  f.io.stderr.write = text => {
    messages.push(text)
    write(text)
  }
  return { ...f, messages }
}
it.each([false, true])('prints neutral delivery progress before sending (wait=%s)', async wait => {
  const f = fixture(),
    original = f.io.fetch
  let sending = ''
  f.io.fetch = (url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.id === 'agent.prompt') {
      sending = `Sending prompt (delivery ${request.payload.deliveryId}).\n`
      expect(f.messages).toEqual([sending])
      expect(f.out()).toBe('')
    }
    if (request.id === 'agent.delivery.get') {
      expect(f.messages).toEqual([sending, waiting])
      expect(f.out()).toBe('')
    }
    return original(url, init)
  }
  expect(
    await run(
      [
        'agent',
        'prompt',
        '--node',
        node.id,
        '--text',
        'hello',
        ...(wait ? ['--wait', '--read'] : []),
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.messages).toEqual(wait ? [sending, waiting] : [sending])
  expect(f.messages.join('')).not.toMatch(
    /Never resend|Do not repeat|Check opencove agent delivery/,
  )
  expect(JSON.parse(f.out())).toMatchObject(
    wait ? { outcome: 'completed', reply: { message: 'Fast reply' } } : { deliveryId: 'd' },
  )
})
it('prints neutral creation IDs before identification and continuation before exact waiting', async () => {
  const f = fixture(),
    original = f.io.fetch
  f.values['node.create'] = {
    revision: 1,
    projectId: 'p',
    spaceId: null,
    node: {
      ...node,
      kind: 'agent',
      sessionId: 's',
      data: { kind: 'agent', provider: 'claude-code' },
    },
  }
  const created = `Created agent node ${node.id} (session s).\n`
  let observations = 0
  f.io.fetch = (url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.id === 'agent.get' && ++observations === 1) {
      expect(f.messages).toEqual([created])
      expect(f.out()).toBe('')
    }
    if (request.id === 'agent.list') {
      expect(f.messages).toEqual([created, waiting])
      expect(f.out()).toBe('')
    }
    return original(url, init)
  }
  expect(
    await run(
      [
        'node',
        'create',
        'agent',
        '--space',
        'space-123456',
        '--prompt',
        'hello',
        '--wait',
        '--read',
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.messages).toEqual([created, waiting])
  expect(f.messages.join('')).not.toMatch(/Never resend|Do not repeat/)
  expect(JSON.parse(f.out())).toMatchObject({
    node: { id: node.id, sessionId: 's' },
    turnId: 't',
    outcome: 'completed',
  })
})
it('retains the existing error recovery warning after unconfirmed delivery', async () => {
  const f = fixture()
  f.values['agent.delivery.get'] = { available: false, deliveryId: 'd', reason: 'unavailable' }
  expect(await run(['agent', 'prompt', '--node', node.id, '--text', 'hello', '--wait'], f.io)).toBe(
    1,
  )
  expect(f.error()).toMatchObject({
    message: 'Prompt submission is unconfirmed. Never resend.',
    hint: expect.stringContaining('Never resend. Check opencove agent delivery d; once confirmed,'),
    details: { deliveryId: 'd', sessionId: 's', turnId: 't' },
    retryable: false,
  })
})
