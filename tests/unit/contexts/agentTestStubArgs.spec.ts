// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { agentTestStubArgs } from '../../../src/shared/utils/agentTestStubArgs'
import { prepareAgentLaunch } from '../../../src/app/main/controlSurface/handlers/prepareAgentLaunch'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
vi.mock('../../../src/platform/os/CommandEnvironmentService', () => ({
  getCommandExecutionEnvironment: async () => ({}),
}))
afterEach(() => vi.unstubAllEnvs())
it.each(['initial-prompt-argv', 'codex-prompt-strict', 'claude-prompt-strict'])(
  'forwards generated Worker args for %s',
  async scenario => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('OPENCOVE_TEST_AGENT_SESSION_SCENARIO', scenario)
    vi.stubEnv('OPENCOVE_TEST_AGENT_STUB_SCRIPT', '/fixture/stub.mjs')
    vi.stubEnv('OPENCOVE_TEST_USE_REAL_AGENTS', '0')
    const launched = await prepareAgentLaunch({
      registry: new AgentProviderRegistry(createBuiltinAgentProviderContributions()),
      provider: 'codex',
      cwd: '/fixture',
      agentFullAccess: false,
      codexReuseRunningAppServer: false,
      executablePathOverride: null,
      mode: 'new',
      model: null,
      opencodeServer: null,
      prompt: '--model=other',
      resumeSessionId: null,
    })
    try {
      expect(launched.launchCommand.args).toEqual([
        ...launched.testStub!.args,
        ...launched.managedLaunch.plan.args,
      ])
      expect(launched.launchCommand.args.slice(-2)).toEqual(['--', '--model=other'])
    } finally {
      await launched.managedLaunch.artifacts.dispose()
    }
  },
)
it('does not append provider operands to the fallback shell command', () => {
  vi.stubEnv('OPENCOVE_TEST_AGENT_SESSION_SCENARIO', '')
  vi.stubEnv('OPENCOVE_TEST_AGENT_STUB_SCRIPT', '/fixture/stub.mjs')
  expect(agentTestStubArgs(['-lc', 'sleep 120'], ['--', 'update'])).toEqual(['-lc', 'sleep 120'])
})
