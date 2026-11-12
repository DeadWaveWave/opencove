import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'

type CapturedRequest = {
  id: string
  payload: {
    data?: Record<string, unknown>
  }
}

function stubInvokeRequests(): CapturedRequest[] {
  const requests: CapturedRequest[] = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    requests.push(JSON.parse(body) as CapturedRequest)
    return new Response(
      JSON.stringify({
        __opencoveControlEnvelope: true,
        ok: true,
        value: { ok: true },
      }),
    )
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  return requests
}

async function invokeNodeArgs(args: string[]): Promise<boolean> {
  return (
    (await run(args, {
      stdout: { write() {} },
      stderr: { write() {} },
      env: { OPENCOVE_CONTROL_URL: 'http://localhost:1', OPENCOVE_CONTROL_TOKEN: 'token' },
      fetch,
      now: Date.now,
      readTextFile: async () => '',
      readStdinText: async () => '',
    })) === 0
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CLI node control commands', () => {
  it('omits website profile fields unless the update command explicitly provides them', async () => {
    const requests = stubInvokeRequests()

    const handled = await invokeNodeArgs([
      'node',
      'update',
      'website',
      '--node',
      'node-1',
      '--url',
      'https://example.com',
    ])

    expect(handled).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      id: 'node.update',
      payload: {
        data: {
          url: 'https://example.com',
        },
      },
    })
    expect(requests[0].payload.data).not.toHaveProperty('profileId')
    expect(requests[0].payload.data).not.toHaveProperty('sessionMode')
  })

  it('includes website profile fields when the update command provides them', async () => {
    const requests = stubInvokeRequests()

    const handled = await invokeNodeArgs([
      'node',
      'update',
      'website',
      '--node',
      'node-1',
      '--session-mode',
      'profile',
      '--profile',
      'profile-1',
    ])

    expect(handled).toBe(true)
    expect(requests[0]).toMatchObject({
      id: 'node.update',
      payload: {
        data: {
          sessionMode: 'profile',
          profileId: 'profile-1',
        },
      },
    })
  })
})

it.each(['agent', 'terminal'])(
  'renames a %s without sending data or launch options',
  async kind => {
    const requests = stubInvokeRequests()
    expect(
      await invokeNodeArgs(['node', 'update', kind, '--node', 'node-1', '--title', 'Lead']),
    ).toBe(true)
    expect(requests[0]).toMatchObject({
      id: 'node.update',
      payload: { kind, nodeId: 'node-1', title: 'Lead' },
    })
    expect(requests[0].payload).not.toHaveProperty('data')
  },
)

it.each([
  ['agent', '--prompt', 'unexpected'],
  ['terminal', '--command', 'pwd'],
  ['agent', '--title', '   '],
])(
  'rejects unsupported or blank rename options before connecting: %j',
  async (kind, option, value) => {
    const requests = stubInvokeRequests()
    expect(await invokeNodeArgs(['node', 'update', kind, '--node', 'node-1', option, value])).toBe(
      false,
    )
    expect(requests).toHaveLength(0)
  },
)

it('keeps a literal provider-prefixed name when renaming through the CLI', async () => {
  const requests = stubInvokeRequests()
  expect(
    await invokeNodeArgs([
      'node',
      'update',
      'agent',
      '--node',
      'node-1',
      '--title',
      'codex · Lead',
    ]),
  ).toBe(true)
  expect(requests[0]).toMatchObject({ id: 'node.update', payload: { title: 'codex · Lead' } })
})
