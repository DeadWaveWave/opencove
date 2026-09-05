import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeHookChannel } from '../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { createCodexHookChannel } from '../../src/app/main/controlSurface/agentHook/codexHookChannel'
import type { ControlSurfacePtyRuntime } from '../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createMultiEndpointPtyRuntime } from '../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { WorkerTopologyStore } from '../../src/app/main/controlSurface/topology/topologyStore'
import { createManagedAgentLaunchPlan } from '../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import { ClaudeCodeAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { CodexAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { KimiAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/kimi/KimiAgentProviderContribution'
import { PiAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'
import type { AgentProviderId } from '../../src/shared/contracts/dto'

const globalConfigRelativePaths = [
  ['.claude', 'settings.json'],
  ['.codex', 'hooks.json'],
  ['.codex', 'config.toml'],
  ['.pi', 'agent', 'settings.json'],
  ['.kimi-code', 'config.toml'],
  ['.kimi-code', 'tui.toml'],
] as const

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ephemeral Agent Provider launch', () => {
  it('leaves every user-level provider config byte-for-byte unchanged', async () => {
    const testHome = await mkdtemp(join(tmpdir(), 'opencove-provider-home-'))
    vi.stubEnv('HOME', testHome)
    vi.stubEnv('USERPROFILE', testHome)
    expect(homedir()).toBe(testHome)
    const globalConfigPaths = globalConfigRelativePaths.map(parts => join(testHome, ...parts))
    const sentinels = globalConfigPaths.map((_, index) =>
      Buffer.from(`user-owned-config-${String(index)}\n\u0000`, 'utf8'),
    )
    await Promise.all(
      globalConfigPaths.map(async (path, index) => {
        await mkdir(join(path, '..'), { recursive: true })
        await writeFile(path, sentinels[index]!)
      }),
    )
    const before = await Promise.all(globalConfigPaths.map(async path => await readFile(path)))

    const claudeChannel = createClaudeHookChannel({})
    const codexChannel = createCodexHookChannel({})
    let emitExit: ((event: { sessionId: string; exitCode: number }) => void) | null = null
    let nextSessionId = 0
    const localRuntime = {
      spawnSession: vi.fn(async () => ({ sessionId: `session-${String(++nextSessionId)}` })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(listener => {
        emitExit = listener
        return () => undefined
      }),
    } as unknown as ControlSurfacePtyRuntime
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime,
      topology: {} as WorkerTopologyStore,
      disposeLocalRuntime: false,
      agentStateSources: [claudeChannel, codexChannel],
    })

    try {
      const claude = await createManagedAgentLaunchPlan(
        new ClaudeCodeAgentProviderContribution({
          channel: claudeChannel,
          runtimeExecutable: '/runtime/node',
        }),
        launchCommand('claude-code'),
      )
      const settingsIndex = claude.plan.args.indexOf('--settings')
      const settingsPath = claude.plan.args[settingsIndex + 1]!
      const claudeSession = await runtime.spawnSession({
        cwd: testHome,
        cols: 80,
        rows: 24,
        command: claude.plan.command,
        args: [...claude.plan.args],
        env: { ...claude.plan.env },
        launchArtifacts: claude.artifacts,
      })
      claude.plan.onStarted?.(claudeSession.sessionId)
      await expect(access(settingsPath)).resolves.toBeUndefined()

      const codex = await createManagedAgentLaunchPlan(
        new CodexAgentProviderContribution({
          channel: codexChannel,
          hookTrustResolver: vi.fn(async () => null),
          runtimeExecutable: '/runtime/node',
        }),
        launchCommand('codex'),
      )
      expect(codex.plan.args).not.toContain('--settings')
      const codexSession = await runtime.spawnSession({
        cwd: testHome,
        cols: 80,
        rows: 24,
        command: codex.plan.command,
        args: [...codex.plan.args],
        env: { ...codex.plan.env },
        launchArtifacts: codex.artifacts,
      })
      codex.plan.onStarted?.(codexSession.sessionId)

      const pi = await createManagedAgentLaunchPlan(
        new PiAgentProviderContribution(),
        launchCommand('pi'),
      )
      expect(pi.plan).toMatchObject({ command: 'pi', env: {} })
      const piSession = await runtime.spawnSession({
        cwd: testHome,
        cols: 80,
        rows: 24,
        command: pi.plan.command,
        args: [...pi.plan.args],
        env: { ...pi.plan.env },
        launchArtifacts: pi.artifacts,
      })

      const kimi = await createManagedAgentLaunchPlan(
        new KimiAgentProviderContribution(),
        launchCommand('kimi'),
      )
      expect(kimi.plan).toMatchObject({ command: 'kimi', env: {} })
      const kimiSession = await runtime.spawnSession({
        cwd: testHome,
        cols: 80,
        rows: 24,
        command: kimi.plan.command,
        args: [...kimi.plan.args],
        env: { ...kimi.plan.env },
        launchArtifacts: kimi.artifacts,
      })

      const after = await Promise.all(globalConfigPaths.map(async path => await readFile(path)))
      expect(after).toEqual(before)

      emitExit?.({ sessionId: claudeSession.sessionId, exitCode: 0 })
      emitExit?.({ sessionId: codexSession.sessionId, exitCode: 0 })
      emitExit?.({ sessionId: piSession.sessionId, exitCode: 0 })
      emitExit?.({ sessionId: kimiSession.sessionId, exitCode: 0 })
      await vi.waitFor(async () => {
        await expect(access(settingsPath)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(claude.artifacts.isDisposed).toBe(true)
        expect(codex.artifacts.isDisposed).toBe(true)
        expect(pi.artifacts.isDisposed).toBe(true)
        expect(kimi.artifacts.isDisposed).toBe(true)
      })
    } finally {
      runtime.dispose()
      await Promise.all([claudeChannel.dispose(), codexChannel.dispose()])
      await rm(testHome, { recursive: true, force: true })
    }
  })
})

function launchCommand(provider: AgentProviderId) {
  return {
    mode: 'new' as const,
    prompt: 'Explain the change',
    model: null,
    resumeSessionId: null,
    agentFullAccess: true,
    workspaceDirectory: homedir(),
    executablePathOverride:
      provider === 'claude-code' ? 'claude' : provider === 'codex' ? 'codex' : provider,
  }
}
