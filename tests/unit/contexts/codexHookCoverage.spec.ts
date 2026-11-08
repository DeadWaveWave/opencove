// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'
import type { CodexSessionFileDiscovery } from '../../../src/contexts/agent/infrastructure/cli/CodexSessionFileDiscovery'

const daemon = vi.hoisted(() => ({ live: false }))
vi.mock('node:net', async importOriginal => {
  const actual = await importOriginal<typeof import('node:net')>()
  const { EventEmitter } = await import('node:events')
  return {
    ...actual,
    connect: () => {
      const socket = Object.assign(new EventEmitter(), { destroy() {}, setTimeout() {} })
      queueMicrotask(() => socket.emit(daemon.live ? 'connect' : 'error'))
      return socket
    },
  }
})
afterEach(() => {
  daemon.live = false
})
it.each([
  ['trusted', 'lifecycle', 'installed'],
  ['null-trust', 'notify_only', 'installed'],
  ['throw-trust', 'notify_only', 'installed'],
  ['daemon', 'none', 'skipped'],
  ['daemon-default', 'lifecycle', 'installed'],
  ['windows', 'none', 'not_required'],
  ['no-channel', 'none', 'not_installed'],
  ['unavailable', 'none', 'error'],
] as const)('records coverage for %s', async (branch, hookCoverage, hookInstallState) => {
  const artifacts = new AgentLaunchArtifactScope()
  const reserveSpawn = vi.fn(async () => ({
    usesHook: branch !== 'unavailable',
    installState: branch === 'unavailable' ? ('error' as const) : ('installed' as const),
    env: {},
    commit: vi.fn(),
    dispose: vi.fn(async () => {}),
  }))
  const hookTrustResolver = vi.fn(async () => {
    if (branch === 'throw-trust') {
      throw new Error('unsupported')
    }
    return branch === 'null-trust' ? null : 'hooks.state={}'
  })
  // A live shared daemon is skipped only when the user opted into reusing it.
  daemon.live = branch === 'daemon' || branch === 'daemon-default'
  const provider = new CodexAgentProviderContribution({
    channel:
      branch === 'no-channel' ? undefined : ({ reserveSpawn } as unknown as AgentHookChannel),
    runtimePlatform: branch === 'windows' ? 'win32' : 'linux',
    hookTrustResolver,
    sessionDiscovery: {
      reserve: () => ({ start() {}, async dispose() {} }),
    } as unknown as CodexSessionFileDiscovery,
  })
  try {
    const plan = await provider.hookInjection.prepareHookInjection({
      artifacts,
      workspaceDirectory: '/tmp',
      environment: { CODEX_HOME: '/tmp/opencove-coverage-fixture' },
      ...(branch === 'daemon' ? { codexReuseRunningAppServer: true } : {}),
    })
    expect(plan).toMatchObject({ hookCoverage, hookInstallState })
    expect(plan.args.some(arg => arg.startsWith('hooks.Stop='))).toBe(
      branch === 'trusted' || branch === 'daemon-default',
    )
    if (['daemon', 'windows', 'no-channel', 'unavailable'].includes(branch)) {
      expect(hookTrustResolver).not.toHaveBeenCalled()
    }
  } finally {
    artifacts.seal()
    await artifacts.dispose()
  }
})
