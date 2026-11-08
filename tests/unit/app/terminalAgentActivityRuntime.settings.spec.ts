// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createTerminalAgentActivityRuntime } from '../../../src/app/main/controlSurface/terminalAgentActivityRuntime'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'

const captured = vi.hoisted(() => ({ resolve: undefined as undefined | (() => Promise<boolean>) }))
vi.mock(
  '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway',
  () => ({
    TerminalAgentActivityGateway: class {
      constructor(options: { resolveCodexReuseRunningAppServer: () => Promise<boolean> }) {
        captured.resolve = options.resolveCodexReuseRunningAppServer
      }
      async dispose() {}
    },
  }),
)
it('normalizes persisted Codex reuse settings at each gateway prepare instead of caching startup settings', async () => {
  let settings: Record<string, unknown> = {}
  const readAppState = vi.fn(async () => ({ settings }))
  const runtime = createTerminalAgentActivityRuntime({
    userDataPath: '/tmp/opencove-runtime-policy-unit',
    agentHookChannels: [],
    agentProviderRegistry: new AgentProviderRegistry([]),
    getPersistenceStore: async () => ({ readAppState }),
  })
  try {
    await expect(captured.resolve!()).resolves.toBe(false)
    settings = { codexReuseRunningAppServer: true }
    await expect(captured.resolve!()).resolves.toBe(true)
    settings = { codexReuseRunningAppServer: false }
    await expect(captured.resolve!()).resolves.toBe(false)
    expect(readAppState).toHaveBeenCalledTimes(3)
  } finally {
    await runtime.dispose()
  }
})
