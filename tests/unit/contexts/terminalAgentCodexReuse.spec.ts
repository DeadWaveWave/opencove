// @vitest-environment node
import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { TerminalAgentActivityGateway } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'
import type { TerminalSessionMetadataEvent } from '../../../src/shared/contracts/dto'

vi.mock('node:net', async importOriginal => {
  const actual = await importOriginal<typeof import('node:net')>()
  const connectMock = vi.fn(() => {
    const socket = Object.assign(new EventEmitter(), { destroy() {}, setTimeout() {} })
    queueMicrotask(() => socket.emit('connect'))
    return socket
  })
  return { ...actual, connect: connectMock, default: { ...actual, connect: connectMock } }
})
afterEach(() => vi.clearAllMocks())

function httpHarness() {
  let listener!: (request: IncomingMessage, response: ServerResponse) => void
  const server = Object.assign(new EventEmitter(), {
    listening: true,
    listen: (_port: number, _host: string, ready: () => void) => ready(),
    address: () => ({ port: 1 }),
    close: (done: () => void) => {
      server.listening = false
      done()
    },
    closeAllConnections: () => {},
  })
  return {
    createHttpServer: ((handler: typeof listener) => {
      listener = handler
      return server
    }) as unknown as typeof createServer,
    post: async (token: string, invocationId: string) =>
      await new Promise<{ status: number; args: string[] }>(resolve => {
        const request = Object.assign(
          Readable.from([
            JSON.stringify({
              operation: 'prepare',
              provider: 'codex',
              invocationId,
              cwd: '/tmp/workspace',
              executablePath: '/tmp/test-codex',
              arguments: [],
              environment: { CODEX_HOME: '/tmp/opencove-terminal-codex-unit' },
            }),
          ]),
          {
            method: 'POST',
            url: '/terminal-agent/activity',
            headers: { 'x-opencove-terminal-agent-token': token },
          },
        )
        const response = {
          statusCode: 0,
          setHeader() {},
          end(body?: string) {
            const result = JSON.parse(body ?? '{}') as { args: string[] }
            resolve({ status: response.statusCode, args: result.args ?? [] })
          },
        }
        listener(request as unknown as IncomingMessage, response as unknown as ServerResponse)
      }),
  }
}

it.skipIf(process.platform === 'win32')(
  'reads the current persisted policy for each ordinary-terminal Codex invocation beside a live daemon',
  async () => {
    let reuse = false
    const http = httpHarness()
    const registry = new TerminalAgentInvocationRegistry()
    const metadata: TerminalSessionMetadataEvent[] = []
    registry.onMetadata(event => metadata.push(event))
    const provider = new CodexAgentProviderContribution({
      channel: {
        reserveSpawn: async () => ({
          usesHook: true,
          installState: 'installed',
          env: {},
          commit() {},
          async dispose() {},
        }),
      } as unknown as AgentHookChannel,
      hookTrustResolver: async () => 'hooks.state={}',
      runtimePlatform: 'linux',
    })
    const plan = vi.spyOn(provider.hookInjection, 'prepareHookInjection')
    const readPolicy = vi.fn(async () => reuse)
    const gateway = new TerminalAgentActivityGateway({
      registry,
      resolveHookInjection: () => provider.hookInjection,
      resolveCodexReuseRunningAppServer: readPolicy,
      createHttpServer: http.createHttpServer,
    })
    const terminal = await gateway.reserveTerminal()
    terminal.commit('terminal-codex')
    try {
      const isolated = await http.post(terminal.token, 'isolated')
      expect(isolated.status).toBe(200)
      expect(isolated.args).toContain('--config')
      expect(plan).toHaveBeenLastCalledWith(
        expect.objectContaining({ codexReuseRunningAppServer: false }),
      )
      expect(connect).not.toHaveBeenCalled()
      expect(
        metadata.some(
          event => event.hookInstallState === 'installed' && event.hookCoverage === 'lifecycle',
        ),
      ).toBe(true)
      reuse = true
      const reused = await http.post(terminal.token, 'reused')
      expect(reused.status).toBe(200)
      expect(reused.args).not.toContain('--config')
      expect(plan).toHaveBeenLastCalledWith(
        expect.objectContaining({ codexReuseRunningAppServer: true }),
      )
      expect(connect).toHaveBeenCalledOnce()
      expect(
        metadata.some(
          event => event.hookInstallState === 'skipped' && event.hookCoverage === 'none',
        ),
      ).toBe(true)
      expect(readPolicy).toHaveBeenCalledTimes(2)
    } finally {
      await terminal.dispose()
      await gateway.dispose()
    }
  },
)

it('does not start hook planning if terminal disposal wins the persisted-setting read', async () => {
  const http = httpHarness()
  let reading!: () => void
  const started = new Promise<void>(resolve => {
    reading = resolve
  })
  let release!: () => void
  const ready = new Promise<void>(resolve => {
    release = resolve
  })
  const planner = vi.fn(async () => ({ args: [], env: {}, hookInstallState: 'installed' as const }))
  const gateway = new TerminalAgentActivityGateway({
    registry: new TerminalAgentInvocationRegistry(),
    createHttpServer: http.createHttpServer,
    resolveHookInjection: () => ({ prepareHookInjection: planner }),
    resolveCodexReuseRunningAppServer: async () => {
      reading()
      await ready
      return true
    },
  })
  const terminal = await gateway.reserveTerminal()
  terminal.commit('closed-during-settings-read')
  const preparing = http.post(terminal.token, 'late-prepare')
  await started
  await terminal.dispose()
  release()
  try {
    await expect(preparing).resolves.toMatchObject({ status: 410 })
    expect(planner).not.toHaveBeenCalled()
  } finally {
    await gateway.dispose()
  }
})
