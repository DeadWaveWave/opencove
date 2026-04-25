import { afterEach, describe, expect, it, vi } from 'vitest'
import { tryHandleNodeControlCommands } from '../../../src/app/cli/commands/nodeControl.mjs'

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
  return await tryHandleNodeControlCommands({
    command: 'node',
    args,
    connection: { hostname: '127.0.0.1', port: 1, token: 'token' },
    pretty: false,
    timeoutMs: 1_000,
  })
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
