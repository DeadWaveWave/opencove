import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { PiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'
import { createAgentLaunchArtifactRoot } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { createAgentHookRelay } from '../../../src/contexts/agent/infrastructure/providers/shared/AgentHookRelay'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'

let userDataPath: string
let artifacts: AgentLaunchArtifactScope

beforeEach(async () => {
  // Keep the profile outside the OS temp tree so a temp-root regression is observable.
  userDataPath = await mkdtemp(join(process.cwd(), 'node_modules', 'agent-launch-profile-'))
  artifacts = new AgentLaunchArtifactScope()
})
afterEach(async () => {
  await artifacts.dispose()
  await rm(userDataPath, { recursive: true, force: true })
})

function options() {
  return {
    artifactRoot: createAgentLaunchArtifactRoot(userDataPath),
    runtimeExecutable: process.execPath,
    runtimePlatform: 'linux' as const,
    hookTrustResolver: async () => 'hooks.state={}',
    channel: {
      start: async () => undefined,
      getInstallState: () => 'installed',
      reserveSpawn: async () => ({
        usesHook: true,
        installState: 'installed',
        env: {},
        commit: () => undefined,
        dispose: async () => undefined,
      }),
    } as AgentHookChannel,
  }
}

async function assertFiles(paths: string[], expectedNames: string[]) {
  expect(paths.map(path => basename(path)).sort()).toEqual(expectedNames.sort())
  for (const path of paths) {
    expect(dirname(dirname(path))).toBe(join(userDataPath, 'runtime', 'agent-launch'))
    const fromTemp = relative(tmpdir(), path)
    expect(isAbsolute(fromTemp) || fromTemp.startsWith(`..${sep}`)).toBe(true)
    expect(await readFile(path, 'utf8')).not.toBe('')
    if (process.platform !== 'win32') {
      expect((await stat(dirname(dirname(path)))).mode & 0o777).toBe(0o700)
      expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
  }
  await artifacts.dispose()
  for (const path of paths) {
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  }
}

describe('agent launch artifact location', () => {
  it.each(['claude', 'codex', 'pi'] as const)(
    '%s keeps late-read files under user data',
    async id => {
      const tracked = vi.spyOn(artifacts, 'track')
      const provider =
        id === 'claude'
          ? new ClaudeCodeAgentProviderContribution(options())
          : id === 'codex'
            ? new CodexAgentProviderContribution(options())
            : new PiAgentProviderContribution(options())
      await provider.launcher.createLaunchPlan({
        artifacts,
        mode: 'new',
        prompt: '',
        model: null,
        resumeSessionId: null,
        agentFullAccess: false,
        workspaceDirectory: userDataPath,
      })
      const paths = tracked.mock.calls.flatMap(([, artifact]) =>
        'path' in artifact ? [String(artifact.path)] : [],
      )
      await assertFiles(
        paths,
        id === 'claude'
          ? ['relay.mjs', 'settings.json']
          : id === 'codex'
            ? ['relay.mjs']
            : ['status.ts'],
      )
    },
  )

  it.each(['claude', 'codex'] as const)(
    '%s Windows launcher stays beside its relay',
    async provider => {
      const tracked = vi.spyOn(artifacts, 'track')
      await createAgentHookRelay({ ...options(), provider, runtimePlatform: 'win32', artifacts })
      const paths = tracked.mock.calls.flatMap(([, artifact]) =>
        'path' in artifact ? [String(artifact.path)] : [],
      )
      await assertFiles(paths, ['relay.mjs', 'launch.ps1'])
    },
  )
})
