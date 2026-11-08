import { EventEmitter } from 'node:events'
import { connect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'

vi.mock('node:net', async importOriginal => {
  const original = await importOriginal<typeof import('node:net')>()
  const connectMock = vi.fn()
  return { ...original, connect: connectMock, default: { ...original, connect: connectMock } }
})
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

describe.skipIf(process.platform === 'win32').each(['HOME', 'CODEX_HOME'])(
  'Codex app-server reuse via %s',
  homeSource => {
    it.each([
      { reuse: undefined, reachable: true, skipped: false },
      { reuse: false, reachable: true, skipped: false },
      { reuse: true, reachable: true, skipped: true },
      { reuse: true, reachable: false, skipped: false },
    ])(
      'reuse=$reuse reachable=$reachable skips hooks=$skipped',
      async ({ reuse, reachable, skipped }) => {
        const root = '/tmp/opencove-daemon-unit-home'
        vi.stubEnv('HOME', root)
        vi.stubEnv('USERPROFILE', root)
        const codexHome = homeSource === 'HOME' ? `${root}/.codex` : root
        const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(), setTimeout: vi.fn() })
        vi.mocked(connect).mockImplementation(() => {
          queueMicrotask(() =>
            socket.emit(reachable ? 'connect' : 'error', new Error('unavailable')),
          )
          return socket as unknown as ReturnType<typeof connect>
        })
        const dispose = vi.fn(async () => undefined)
        const commit = vi.fn()
        const channel = {
          reserveSpawn: vi.fn(async () => ({
            usesHook: true,
            installState: 'installed',
            env: {},
            dispose,
            commit,
          })),
        } as unknown as AgentHookChannel
        const artifacts = new AgentLaunchArtifactScope()
        const trust = vi.fn(async () => "hooks.state={'hook'={trusted_hash='sha256:abc'}}")
        const provider = new CodexAgentProviderContribution({
          channel,
          hookTrustResolver: trust,
          runtimePlatform: 'linux',
        })
        try {
          const plan = await provider.launcher.createLaunchPlan({
            artifacts,
            mode: 'new',
            prompt: 'ACK',
            model: null,
            resumeSessionId: null,
            workspaceDirectory: '/tmp/workspace',
            agentFullAccess: false,
            codexReuseRunningAppServer: reuse,
            environment: homeSource === 'CODEX_HOME' ? { CODEX_HOME: codexHome } : {},
          })
          expect(connect).toHaveBeenCalledTimes(reuse ? 1 : 0)
          if (reuse) {
            expect(connect).toHaveBeenCalledWith(
              `${codexHome}/app-server-control/app-server-control.sock`,
            )
            expect(socket.destroy).toHaveBeenCalledOnce()
          }
          expect(plan.hookInstallState).toBe(skipped ? 'skipped' : 'installed')
          expect(plan.hookCoverage).toBe(skipped ? 'none' : 'lifecycle')
          expect(plan.args.includes('--config')).toBe(!skipped)
          expect(trust).toHaveBeenCalledTimes(skipped ? 0 : 1)
          if (!skipped) {
            expect(plan.args.join('\n')).toContain('hooks.SessionStart=')
            expect(plan.args.join('\n')).toContain('hooks.SessionEnd=')
            expect(plan.args.join('\n')).toContain('notify=')
          }
          plan.onStarted?.('pty-codex')
          expect(commit).toHaveBeenCalledExactlyOnceWith('pty-codex')
        } finally {
          artifacts.seal()
          await artifacts.dispose()
        }
        expect(dispose).toHaveBeenCalledOnce()
      },
    )
  },
)
