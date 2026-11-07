import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { promptAdmission } from '../../../src/contexts/agent/application/promptAdmission'
import { toLocalAgentLaunchInput } from '../../../src/app/main/controlSurface/handlers/sessionLaunchPayloadSupport'
// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { managedHookCoverage } from '../../../src/contexts/agent/infrastructure/providers/shared/ManagedHookCoverage'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { createCodexHookTrustConfiguration } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexHookTrustResolver'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'
import { prepareAgentLaunch } from '../../../src/app/main/controlSurface/handlers/prepareAgentLaunch'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'

vi.mock('node:net', async importOriginal => {
  const actual = await importOriginal<typeof import('node:net')>()
  return {
    ...actual,
    connect: () => {
      const socket = Object.assign(new EventEmitter(), { destroy() {}, setTimeout() {} })
      queueMicrotask(() => socket.emit('error'))
      return socket
    },
  }
})
const channel = {
  reserveSpawn: async () => ({
    usesHook: true,
    installState: 'installed',
    env: {},
    commit() {},
    async dispose() {},
  }),
} as unknown as AgentHookChannel
const command = { model: null, resumeSessionId: null }
it.each(['codex', 'claude-code'] as const)(
  '%s coverage requires generated hook argv and refuses user override paths/option-like values',
  provider => {
    const hooks = {
      args:
        provider === 'codex'
          ? ['--config', 'hooks.Stop=generated', '--config', 'hooks.state=trusted']
          : ['--settings', '/generated/settings.json'],
      hookCoverage: 'lifecycle' as const,
    }
    const generated = ['--model', 'm', ...hooks.args]
    const fallback = provider === 'codex' ? 'notify_only' : 'none'
    expect(managedHookCoverage(provider, generated, hooks, command)).toBe('lifecycle')
    expect(managedHookCoverage(provider, generated.slice(0, -1), hooks, command)).toBe(fallback)
    expect(managedHookCoverage(provider, ['--', ...generated], hooks, command)).toBe(fallback)
    for (const args of [
      ['--config', 'hooks.UserPromptSubmit=[]'],
      ['--config=hooks.PermissionRequest=[]'],
      ['-chooks.Stop=[]'],
      ['--settings=/override'],
      ['--setting-sources', 'user'],
    ]) {
      expect(managedHookCoverage(provider, [...generated, ...args], hooks, command)).toBe(fallback)
      expect(managedHookCoverage(provider, [...generated, '--', ...args], hooks, command)).toBe(
        'lifecycle',
      )
    }
    expect(
      managedHookCoverage(provider, generated, hooks, {
        ...command,
        executablePathOverride: '/user/wrapper',
      }),
    ).toBe('unverified_executable')
    expect(
      managedHookCoverage(
        provider,
        [],
        { args: [], hookCoverage: 'none' },
        { ...command, executablePathOverride: '/user/wrapper' },
      ),
    ).toBe('unverified_executable')
    for (const extra of [
      { model: '--disable-hooks' },
      { model: '  -chooks.Stop=[]' },
      { resumeSessionId: '-chooks.UserPromptSubmit=[]' },
      { resumeSessionId: ' -chooks.PermissionRequest=[]' },
    ]) {
      expect(managedHookCoverage(provider, generated, hooks, { ...command, ...extra })).toBe(
        fallback,
      )
    }
  },
)
it.each([
  ['codex', true],
  ['claude-code', true],
  ['codex', false],
  ['claude-code', false],
] as const)(
  '%s actual planner/fence admission names the executable override (override: %s)',
  async (provider, overridden) => {
    const artifacts = new AgentLaunchArtifactScope()
    const f = promptDeliveryRuntimeFixture(undefined, provider)
    const contribution =
      provider === 'codex'
        ? new CodexAgentProviderContribution({
            channel,
            runtimePlatform: 'linux',
            hookTrustResolver: async () => 'hooks.state={}',
          })
        : new ClaudeCodeAgentProviderContribution({ channel })
    try {
      const plan = await contribution.launcher.createLaunchPlan({
        ...command,
        artifacts,
        mode: 'new',
        workspaceDirectory: '/tmp',
        agentFullAccess: false,
        executablePathOverride: overridden ? '/user/wrapper' : null,
        environment: { CODEX_HOME: '/tmp/opencove-managed-coverage' },
      })
      expect(plan.hookCoverage).toBe(overridden ? 'unverified_executable' : 'lifecycle')
      f.runtime.metadata({
        sessionId: 's',
        resumeSessionId: plan.resumeSessionId,
        agentProvider: provider,
        agentLaunchKind: 'managed',
        hookCoverage: plan.hookCoverage,
        hookInstallState: plan.hookInstallState,
      })
      f.observe('Stop')
      const fence = f.registry.readFence({ sessionId: 's' })!
      expect(fence.hookCoverage).toBe(plan.hookCoverage)
      expect(fence.snapshot).toMatchObject({ state: 'idle', quality: 'authoritative' })
      const capability = () => ({ supported: true as const, submitDelayMs: 300 })
      if (overridden) {
        expect(promptAdmission(fence, capability)).toEqual({
          code: 'agent.prompt_unsupported',
          reason: 'executable_override_unverified',
        })
        await expect(f.deliver()).rejects.toMatchObject({
          code: 'agent.prompt_unsupported',
          details: {
            reason: 'executable_override_unverified',
            pasteDispatchAttempted: false,
            submitDispatchAttempted: false,
          },
        })
        expect(f.write).not.toHaveBeenCalled()
        for (const state of ['waiting', 'working', 'unknown'] as const) {
          expect(
            promptAdmission({ ...fence, snapshot: { ...fence.snapshot, state } }, capability),
          ).toEqual({
            code: 'agent.prompt_unsupported',
            reason: 'executable_override_unverified',
          })
        }
      } else {
        expect(promptAdmission(fence, capability)).toBeNull()
      }
      expect(plan.args).toContain(provider === 'codex' ? '--config' : '--settings')
    } finally {
      f.dispose()
      artifacts.seal()
      await artifacts.dispose()
    }
  },
)
it('managed Codex uses the effective CODEX_HOME environment and every generated lifecycle argument', async () => {
  const trust = vi.fn(async () => 'hooks.state={}')
  const contribution = new CodexAgentProviderContribution({
    channel,
    runtimePlatform: 'linux',
    hookTrustResolver: trust,
  })
  const result = await prepareAgentLaunch({
    ...command,
    registry: new AgentProviderRegistry([contribution]),
    provider: 'codex',
    cwd: '/tmp',
    agentFullAccess: false,
    mode: 'new',
    prompt: '--config hooks.UserPromptSubmit=[]',
    executablePathOverride: null,
    opencodeServer: null,
    environment: { CODEX_HOME: '/tmp/opencove-managed-coverage', COVERAGE_ENV_MARKER: 'requested' },
  })
  try {
    expect(trust.mock.calls[0][0].environment).toMatchObject({
      CODEX_HOME: '/tmp/opencove-managed-coverage',
      COVERAGE_ENV_MARKER: 'requested',
    })
    const configurations = trust.mock.calls[0][0].hookConfigurations
    const args = result.managedLaunch.plan.args
    expect(result.managedLaunch.plan.hookCoverage).toBe('lifecycle')
    for (const event of [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'SessionEnd',
    ]) {
      const config = configurations.find(value => value.startsWith(`hooks.${event}=`))!
      expect(args).toContain(config)
      expect(args[args.indexOf(config) - 1]).toBe('--config')
    }
    expect(args.slice(-2)).toEqual(['--', '--config hooks.UserPromptSubmit=[]'])
  } finally {
    await result.managedLaunch.artifacts.dispose()
  }
})
it('does not claim trust for a generated handler explicitly disabled by effective configuration', () => {
  const hook = {
    command: 'relay',
    handlerType: 'command',
    isManaged: false,
    source: 'sessionFlags',
    currentHash: 'hash',
    key: 'key',
  }
  const response = (enabled: boolean) => ({ data: [{ hooks: [{ ...hook, enabled }] }] })
  expect(createCodexHookTrustConfiguration(response(false), 'relay')).toBeNull()
  expect(createCodexHookTrustConfiguration(response(true), 'relay')).toContain('trusted_hash')
})

it('mounted launch forwarding keeps environment but cannot append user-supplied raw arguments or provenance', () => {
  const payload = {
    mountId: 'm',
    prompt: 'text',
    env: { CODEX_HOME: '/tmp/config' },
    args: ['--config', 'hooks.UserPromptSubmit=[]'],
    agentLaunchKind: 'managed',
  }
  const local = toLocalAgentLaunchInput(payload, '/tmp', 'new')
  expect(local.env).toEqual(payload.env)
  expect(local).not.toHaveProperty('args')
  expect(local).not.toHaveProperty('agentLaunchKind')
})
