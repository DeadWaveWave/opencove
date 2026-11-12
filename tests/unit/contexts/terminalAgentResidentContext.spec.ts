// @vitest-environment node
import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { AgentHookInjectionPlan } from '../../../src/contexts/agent/application/ports/AgentProviderContribution'
import { describe, expect, it } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { TerminalAgentActivityGateway } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import {
  inMemoryClaudeHookChannel,
  inMemoryCodexHookChannel,
} from '../../support/inMemoryClaudeHookChannel'

function gatewayTransport() {
  let listener!: (request: IncomingMessage, response: ServerResponse) => void
  const server = Object.assign(new EventEmitter(), {
    listening: false,
    listen(_port: number, _host: string, ready: () => void) {
      this.listening = true
      ready()
    },
    address: () => ({ port: 12346 }),
    close(done: () => void) {
      this.listening = false
      done()
    },
    closeAllConnections() {},
  })
  return {
    createHttpServer: ((handler: typeof listener) => {
      listener = handler
      return server
    }) as unknown as typeof createServer,
    post: async (token: string, payload: unknown) =>
      await new Promise<{ status: number; env: Record<string, string>; generation: number }>(
        resolve => {
          const request = Object.assign(Readable.from([JSON.stringify(payload)]), {
            method: 'POST',
            url: '/terminal-agent/activity',
            headers: { 'x-opencove-terminal-agent-token': token },
          }) as unknown as IncomingMessage
          const response = {
            statusCode: 0,
            setHeader() {},
            end(body?: string) {
              const parsed = JSON.parse(body ?? '{}') as {
                env?: Record<string, string>
                generation?: number
              }
              resolve({
                status: this.statusCode,
                env: parsed.env ?? {},
                generation: parsed.generation ?? 0,
              })
            },
          } as unknown as ServerResponse
          listener(request, response)
        },
      ),
  }
}

async function fixture(
  provider: 'claude' | 'codex',
  beforePrepared?: (plan: AgentHookInjectionPlan) => Promise<void>,
) {
  const hook = (provider === 'claude' ? inMemoryClaudeHookChannel : inMemoryCodexHookChannel)()
  hook.channel.setResidentContextEnabled!(async () => true)
  const contribution =
    provider === 'claude'
      ? new ClaudeCodeAgentProviderContribution({ channel: hook.channel })
      : new CodexAgentProviderContribution({
          channel: hook.channel,
          runtimePlatform: 'linux',
          hookTrustResolver: async () => 'hooks.state={}',
        })
  const transport = gatewayTransport()
  const registry = new TerminalAgentInvocationRegistry()
  const gateway = new TerminalAgentActivityGateway({
    registry,
    resolveHookInjection: () => ({
      prepareHookInjection: async command => {
        const plan = await contribution.hookInjection.prepareHookInjection(command)
        await beforePrepared?.(plan)
        return plan
      },
    }),
    createHttpServer: transport.createHttpServer,
  })
  const terminal = await gateway.reserveTerminal({ residentContext: 'canvas' })
  const prepare = async (invocationId: string) => {
    const reply = await transport.post(terminal.token, {
      operation: 'prepare',
      provider: contribution.descriptor.id,
      invocationId,
      cwd: '/tmp',
      executablePath: '/tmp/provider',
      arguments: [],
      environment: {},
    })
    expect(reply.status).toBe(200)
    return reply
  }
  const start = async (env: Readonly<NodeJS.ProcessEnv>) =>
    await hook.postReply(env[`OPENCOVE_${provider.toUpperCase()}_HOOK_TOKEN`]!, 'SessionStart')
  return {
    hook,
    registry,
    terminal,
    prepare,
    start,
    async close() {
      await gateway.dispose()
      await hook.channel.dispose()
    },
  }
}

describe.each(['claude', 'codex'] as const)(
  '%s terminal resident context before registration',
  provider => {
    it.each(['before', 'after'] as const)(
      'rejects a displaced invocation %s terminal commit while preserving current early replies',
      async timing => {
        const f = await fixture(provider)
        try {
          const first = await f.prepare('first')
          expect(first.generation).toBe(1)
          expect((await f.start(first.env)).status).toBe(200)
          const second = await f.prepare('second')
          expect(second.generation).toBe(2)
          expect(f.registry.list().entries).toEqual([])
          // No PTY registration yet: the newest invocation must already receive context.
          expect((await f.start(second.env)).status).toBe(200)
          if (timing === 'after') {
            f.terminal.commit('pty')
          }
          expect(await f.start(first.env)).toEqual({ status: 204, body: '', headers: {} })
          if (timing === 'before') {
            f.terminal.commit('pty')
          }
          expect((await f.start(second.env)).status).toBe(200)
          expect(f.registry.list().entries[0]).toMatchObject({
            sessionId: 'pty',
            terminalAgentActivity: { generation: 2, invocationId: 'second' },
          })
        } finally {
          await f.close()
        }
      },
    )
    it('rechecks invocation displacement during the settings await without PTY commit', async () => {
      const f = await fixture(provider)
      let started!: () => void
      const reading = new Promise<void>(resolve => {
        started = resolve
      })
      let finish!: (enabled: boolean) => void
      const settings = new Promise<boolean>(resolve => {
        finish = resolve
      })
      try {
        const first = await f.prepare('first')
        f.hook.channel.setResidentContextEnabled!(async () => {
          started()
          return await settings
        })
        const waiting = f.start(first.env)
        await reading
        const second = await f.prepare('second')
        finish(true)
        expect(await waiting).toEqual({ status: 204, body: '', headers: {} })
        f.hook.channel.setResidentContextEnabled!(async () => true)
        expect((await f.start(second.env)).status).toBe(200)
      } finally {
        finish(true)
        await f.close()
      }
    })

    it('fails closed until the reservation has an invocation handle, then permits the current early reply', async () => {
      let replyBeforeBinding = 0
      const f = await fixture(provider, async plan => {
        replyBeforeBinding = (await f.start(plan.env)).status
      })
      try {
        const current = await f.prepare('current')
        expect(replyBeforeBinding).toBe(204)
        expect((await f.start(current.env)).status).toBe(200)
      } finally {
        await f.close()
      }
    })
  },
)
