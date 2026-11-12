// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { invoke } from '../../../src/app/cli/core/transport'
import { sendAgentPrompt } from '../../../src/app/cli/core/agentPromptRequest'
import type { CommandContext } from '../../../src/app/cli/core/command'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { identityFixture } from './cliIdentity.helpers'

const olderWorkerMessage = (id: string) =>
  `The connected OpenCove Worker is older than this CLI and does not support ${id}. Restart or update OpenCove.`

it.each([
  { args: ['ping'], id: 'system.ping' },
  {
    args: ['fs', 'write', '--uri', 'file:///repo/note.txt', '--content', 'Hello'],
    id: 'filesystem.writeFileText',
  },
])('reports a missing Worker handler for $id as incompatible', async ({ args, id }) => {
  const f = identityFixture(false)
  const worker = createControlSurface()
  f.io.fetch = async (_url, init) =>
    new Response(
      JSON.stringify(
        await worker.invoke({ now: () => new Date() }, JSON.parse(String(init?.body))),
      ),
    )
  expect(await run(args, f.io)).toBe(5)
  expect(f.out()).toBe('')
  expect(f.error()).toMatchObject({ code: 'common.invalid_input', message: olderWorkerMessage(id) })
})

it('recognizes a missing prompt handler before prompt input validation', async () => {
  const worker = createControlSurface()
  await expect(
    invoke(
      { endpoint: 'http://fixture', token: 'secret' },
      { kind: 'command', id: 'agent.prompt', payload: {} },
      {
        timeoutMs: 1000,
        fetch: async (_url, init) =>
          new Response(
            JSON.stringify(
              await worker.invoke({ now: () => new Date() }, JSON.parse(String(init?.body))),
            ),
          ),
      },
    ),
  ).rejects.toMatchObject({
    code: 'common.invalid_input',
    exitCode: 5,
    message: olderWorkerMessage('agent.prompt'),
  })
})

it.each([
  { debugMessage: undefined },
  { debugMessage: 'Invalid ping input.' },
  { debugMessage: 'Error: Unknown control surface query: system.ping.extra' },
  { debugMessage: 'Error: Unknown control surface query: system.pin' },
  { debugMessage: 'Error: Unknown control surface query: agent.get' },
  { debugMessage: 'Error: Unknown control surface command: system.ping' },
  { debugMessage: 'Error: Unknown control surface stream: system.ping' },
  { debugMessage: 'Error: Unknown control surface query: system.ping\n' },
  { debugMessage: 'Invalid field: Unknown control surface query: system.ping' },
  {
    debugMessage: 'Invalid ping fields.',
    details: { issues: [{ path: ['input'], code: 'invalid_type', expected: 'string' }] },
  },
])('keeps ordinary or nonmatching invalid input at exit 2: $debugMessage', async error => {
  const f = identityFixture(false)
  f.io.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: { code: 'common.invalid_input', ...error } }))
  expect(await run(['ping'], f.io)).toBe(2)
  expect(f.out()).toBe('')
  expect(f.error().code).toBe('common.invalid_input')
  expect(f.error().message).not.toContain('Worker is older')
})

it('does not reclassify another error code with the same diagnostic', async () => {
  const f = identityFixture(false)
  f.io.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'common.unexpected',
          debugMessage: 'Error: Unknown control surface query: system.ping',
        },
      }),
    )
  expect(await run(['ping'], f.io)).toBe(1)
  expect(f.error().message).not.toContain('Worker is older')
})

it('uses documented exit 5 for an explicitly incompatible Worker protocol', async () => {
  const f = identityFixture(false)
  f.io.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: { code: 'common.protocol_incompatible' } }))
  expect(await run(['ping'], f.io)).toBe(5)
})

it.each(['query', 'command'])(
  'recognizes an exact %s diagnostic without the Error prefix',
  async kind => {
    await expect(
      invoke(
        { endpoint: 'http://fixture', token: 'secret' },
        { kind, id: 'example.operation', payload: {} },
        {
          timeoutMs: 1000,
          fetch: async () =>
            new Response(
              JSON.stringify({
                ok: false,
                error: {
                  code: 'common.invalid_input',
                  debugMessage: `Unknown control surface ${kind}: example.operation`,
                },
              }),
            ),
        },
      ),
    ).rejects.toMatchObject({ exitCode: 5, message: olderWorkerMessage('example.operation') })
  },
)

it.each(['', 'Error: '])(
  'preserves optional describe negotiation with diagnostic prefix %j',
  async prefix => {
    const requests: string[] = []
    const call: CommandContext['invoke'] = (id, payload) =>
      invoke(
        { endpoint: 'http://fixture', token: 'secret' },
        { id, kind: id === 'agent.prompt' ? 'command' : 'query', payload },
        {
          timeoutMs: 1000,
          fetch: async () => {
            requests.push(id)
            return new Response(
              JSON.stringify(
                id === 'system.operation.describe'
                  ? {
                      ok: false,
                      error: {
                        code: 'common.invalid_input',
                        debugMessage: `${prefix}Unknown control surface query: system.operation.describe`,
                      },
                    }
                  : {
                      ok: true,
                      value: {
                        deliveryId: 'delivery',
                        nodeId: 'node',
                        sessionId: 'session',
                        turnId: 'turn',
                        phase: 'submission_observed',
                      },
                    },
              ),
            )
          },
        },
      )
    await expect(
      sendAgentPrompt({
        invoke: call,
        options: {},
        input: { nodeId: 'node', text: 'Hello' },
        io: { stderr: { write: () => {} } },
      } as unknown as CommandContext),
    ).resolves.toMatchObject({ phase: 'submission_observed' })
    expect(requests).toEqual(['system.operation.describe', 'agent.prompt'])
  },
)

it('keeps ordinary prompt validation at exit 2', async () => {
  await expect(
    invoke(
      { endpoint: 'http://fixture', token: 'secret' },
      { kind: 'command', id: 'agent.prompt', payload: {} },
      {
        timeoutMs: 1000,
        fetch: async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'common.invalid_input',
                debugMessage: 'The prompt text is required.',
              },
            }),
          ),
      },
    ),
  ).rejects.toMatchObject({ code: 'common.invalid_input', exitCode: 2 })
})
