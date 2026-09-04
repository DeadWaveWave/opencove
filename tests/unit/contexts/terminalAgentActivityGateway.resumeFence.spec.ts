import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { TerminalAgentActivityGateway } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import type { TerminalAgentHookContext } from '../../../src/shared/runtime/agentHook/agentHookChannel'

function post(endpoint: string, token: string, payload: unknown): Promise<number> {
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const outgoing = request(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-opencove-terminal-agent-token': token,
      },
    })
    outgoing.once('error', reject)
    outgoing.once('response', response => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    outgoing.end(body)
  })
}

describe('TerminalAgentActivityGateway resume identity fence', () => {
  it('derives the expected Codex resume identity from shim arguments', async () => {
    const registry = new TerminalAgentInvocationRegistry()
    let terminalActivity: TerminalAgentHookContext | null = null
    const gateway = new TerminalAgentActivityGateway({
      registry,
      resolveHookInjection: () => ({
        prepareHookInjection: async () => ({
          args: [],
          env: {},
          hookInstallState: 'installed',
          onStarted: (_sessionId, context) => {
            terminalActivity = context ?? null
          },
        }),
      }),
    })
    const reservation = await gateway.reserveTerminal()
    reservation.commit('pty-1')

    await expect(
      post(reservation.endpoint, reservation.token, {
        operation: 'prepare',
        provider: 'codex',
        invocationId: 'invocation-1',
        cwd: '/tmp/workspace',
        executablePath: '/real/codex',
        arguments: ['resume', 'provider-session-target'],
        environment: { PATH: '/real/bin' },
      }),
    ).resolves.toBe(200)
    expect(terminalActivity).not.toBeNull()
    expect(
      terminalActivity?.observe?.({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'provider-session-unexpected',
      }),
    ).toBe(false)
    expect(registry.list().entries[0]?.resumeSessionId).toBeNull()
    expect(
      terminalActivity?.observe?.({
        identityAuthority: 'provider_session_start',
        resumeSessionId: 'provider-session-target',
      }),
    ).toBe(true)
    expect(registry.list().entries[0]?.resumeSessionId).toBe('provider-session-target')

    await reservation.dispose()
    await gateway.dispose()
  })
})
