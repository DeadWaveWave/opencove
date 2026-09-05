import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { CodexAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import {
  serializeCodexTomlString,
  serializeCodexTomlStringArray,
} from '../../../src/contexts/agent/infrastructure/providers/codex/CodexTomlConfiguration'
import type { AgentHookChannel } from '../../../src/shared/runtime/agentHook/agentHookChannel'

const detector = {
  inspect: vi.fn(async () => ({
    provider: 'codex' as const,
    command: 'codex',
    status: 'available' as const,
    executablePath: '/usr/bin/codex',
    source: 'override' as const,
    diagnostics: [],
  })),
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise(resolveListen => {
    server.listen(socketPath, () => resolveListen())
  })
}

async function closeServer(server: Server): Promise<void> {
  await new Promise(resolveClose => {
    server.close(() => resolveClose())
  })
}

function channel(provider: 'claude' | 'codex') {
  const commit = vi.fn()
  const dispose = vi.fn(async () => undefined)
  const reservation = {
    env:
      provider === 'claude'
        ? {
            OPENCOVE_CLAUDE_HOOK_ENDPOINT: 'http://127.0.0.1:1/hooks/claude',
            OPENCOVE_CLAUDE_HOOK_TOKEN: 'claude-token',
          }
        : {
            OPENCOVE_CODEX_HOOK_ENDPOINT: 'http://127.0.0.1:2/hooks/codex',
            OPENCOVE_CODEX_HOOK_TOKEN: 'codex-token',
          },
    installState: 'installed' as const,
    usesHook: true,
    commit,
    dispose,
  }
  const result = {
    start: vi.fn(async () => undefined),
    reserveSpawn: vi.fn(async () => reservation),
    onState: vi.fn(() => () => undefined),
    onMetadata: vi.fn(() => () => undefined),
    disposeSession: vi.fn(),
    getInstallState: vi.fn(() => 'installed' as const),
    getEndpoint: vi.fn(() => null),
    dispose: vi.fn(async () => undefined),
  } satisfies AgentHookChannel
  return { channel: result, commit, dispose }
}

function launchCommand(
  artifacts: AgentLaunchArtifactScope,
  environment?: Readonly<NodeJS.ProcessEnv>,
) {
  return {
    artifacts,
    mode: 'new' as const,
    prompt: 'Explain the change',
    model: null,
    resumeSessionId: null,
    agentFullAccess: true,
    ...(environment ? { environment } : {}),
    workspaceDirectory: '/tmp/workspace',
  }
}

describe('ClaudeCodeAgentProviderContribution', () => {
  it('injects one private --settings file and tracks every launch artifact', async () => {
    const hook = channel('claude')
    const artifacts = new AgentLaunchArtifactScope()
    const provider = new ClaudeCodeAgentProviderContribution({
      channel: hook.channel,
      detector,
      runtimeExecutable: '/runtime/node',
    })

    const plan = await provider.launcher.createLaunchPlan(launchCommand(artifacts))
    artifacts.seal()

    const settingsIndex = plan.args.indexOf('--settings')
    expect(settingsIndex).toBeGreaterThanOrEqual(0)
    const settingsPath = plan.args[settingsIndex + 1]
    expect(settingsPath).toBeTruthy()
    const settings = JSON.parse(await readFile(settingsPath!, 'utf8'))
    expect(settings.hooks.PermissionRequest[0].hooks[0]).toMatchObject({
      type: 'command',
      command: '/runtime/node',
      args: [expect.stringContaining('opencove-claude-hook-')],
    })
    expect(settings.hooks.SessionStart[0].hooks[0]).toMatchObject({
      type: 'command',
      command: '/runtime/node',
    })
    expect(plan.args.at(-1)).toBe('Explain the change')
    expect(plan.env).toMatchObject({
      OPENCOVE_CLAUDE_HOOK_TOKEN: 'claude-token',
      ELECTRON_RUN_AS_NODE: '1',
    })

    plan.onStarted?.('pty-1')
    expect(hook.commit).toHaveBeenCalledWith('pty-1')
    await artifacts.dispose()
    expect(hook.dispose).toHaveBeenCalledTimes(1)
    await expect(readFile(settingsPath!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('CodexAgentProviderContribution', () => {
  it.skipIf(process.platform === 'win32')(
    'uses the effective terminal environment for an nvm-style Codex executable only during trust planning',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'opencove-codex-nvm-trust-'))
      const rawBin = join(root, 'raw-bin')
      const nvmBin = join(root, 'nvm-bin')
      const executable = join(root, 'codex')
      const marker = join(root, 'app-server-started')
      await Promise.all([mkdir(rawBin), mkdir(nvmBin)])
      await symlink(process.execPath, join(nvmBin, 'node'))
      await writeFile(
        executable,
        [
          '#!/usr/bin/env node',
          "const { writeFileSync } = require('node:fs')",
          "let input = ''",
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', chunk => {",
          '  input += chunk',
          "  let newline = input.indexOf('\\n')",
          '  while (newline >= 0) {',
          '    const message = JSON.parse(input.slice(0, newline))',
          '    input = input.slice(newline + 1)',
          "    if (message.method === 'initialize') { writeFileSync(process.env.NVM_MARKER, message.params.clientInfo.version); process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n') }",
          "    if (message.method === 'hooks/list') process.stdout.write(JSON.stringify({ id: message.id, result: { data: [] } }) + '\\n')",
          "    newline = input.indexOf('\\n')",
          '  }',
          '})',
          '',
        ].join('\n'),
      )
      await chmod(executable, 0o700)
      const originalPath = process.env.PATH
      process.env.PATH = rawBin
      const hook = channel('codex')
      const artifacts = new AgentLaunchArtifactScope()
      const provider = new CodexAgentProviderContribution({
        channel: hook.channel,
        clientVersion: '0.3.0',
        runtimeExecutable: '/runtime/node',
        runtimePlatform: 'linux',
      })

      try {
        const plan = await provider.hookInjection.prepareHookInjection({
          artifacts,
          environment: {
            ...process.env,
            PATH: nvmBin,
            NVM_MARKER: marker,
          },
          executablePathOverride: executable,
          workspaceDirectory: root,
        })
        artifacts.seal()

        await expect(readFile(marker, 'utf8')).resolves.toBe('0.3.0')
        expect(plan.args.join('\n')).not.toContain('hooks.SessionEnd=')
        expect(plan.args.join('\n')).toContain('notify=["/runtime/node"')
        expect(plan.env).not.toHaveProperty('PATH')
        expect(plan.env).not.toHaveProperty('NVM_MARKER')
      } finally {
        if (originalPath === undefined) {
          delete process.env.PATH
        } else {
          process.env.PATH = originalPath
        }
        artifacts.seal()
        await artifacts.dispose()
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('injects trusted hooks and legacy notify as literal --config values', async () => {
    const hook = channel('codex')
    const artifacts = new AgentLaunchArtifactScope()
    const resolveTrust = vi.fn(async () => "hooks.state={'hook'={trusted_hash='sha256:abc'}}")
    const provider = new CodexAgentProviderContribution({
      channel: hook.channel,
      detector,
      hookTrustResolver: resolveTrust,
      runtimeExecutable: '/runtime/node',
      runtimePlatform: 'linux',
    })

    const plan = await provider.launcher.createLaunchPlan(launchCommand(artifacts))
    artifacts.seal()

    expect(resolveTrust).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: 'codex',
        hookCommand: expect.stringMatching(
          /^'\/runtime\/node' '.*opencove-codex-hook-.*\/relay\.mjs'$/u,
        ),
      }),
    )
    expect(plan.args.join('\n')).toContain('hooks.SessionEnd=')
    expect(plan.args).toContain("hooks.state={'hook'={trusted_hash='sha256:abc'}}")
    expect(plan.args.join('\n')).toContain('notify=["/runtime/node"')
    expect(plan.args.at(-1)).toBe('Explain the change')
    expect(plan.env).toMatchObject({
      OPENCOVE_CODEX_HOOK_TOKEN: 'codex-token',
      ELECTRON_RUN_AS_NODE: '1',
    })

    await artifacts.dispose()
  })

  it('falls back to legacy notify when hook trust is unavailable', async () => {
    const hook = channel('codex')
    const artifacts = new AgentLaunchArtifactScope()
    const provider = new CodexAgentProviderContribution({
      channel: hook.channel,
      detector,
      hookTrustResolver: vi.fn(async () => await Promise.reject(new Error('old Codex'))),
      runtimeExecutable: '/runtime/node',
      runtimePlatform: 'linux',
    })

    const plan = await provider.launcher.createLaunchPlan(launchCommand(artifacts))
    artifacts.seal()

    expect(plan.args.join('\n')).not.toContain('hooks.SessionEnd=')
    expect(plan.args.join('\n')).toContain('notify=["/runtime/node"')
    await artifacts.dispose()
  })

  it.skipIf(process.platform === 'win32')(
    'injects no --config overrides when the implicit Codex daemon is live',
    async () => {
      const hook = channel('codex')
      const artifacts = new AgentLaunchArtifactScope()
      const root = await mkdtemp('/tmp/opencove-codex-daemon-')
      const socketPath = join(root, 'app-server-control', 'app-server-control.sock')
      await mkdir(dirname(socketPath), { recursive: true })
      const daemon = createServer(socket => {
        socket.destroy()
      })
      await listen(daemon, socketPath)
      const provider = new CodexAgentProviderContribution({
        channel: hook.channel,
        detector,
        runtimeExecutable: '/runtime/node',
        runtimePlatform: 'linux',
      })

      try {
        const plan = await provider.launcher.createLaunchPlan(
          launchCommand(artifacts, { CODEX_HOME: root }),
        )
        artifacts.seal()

        expect(plan.args).not.toContain('--config')
        expect(plan.env).toMatchObject({
          OPENCOVE_CODEX_HOOK_TOKEN: 'codex-token',
        })
        expect(plan.hookInstallState).toBe('skipped')

        plan.onStarted?.('pty-daemon-1')
        expect(hook.commit).toHaveBeenCalledWith('pty-daemon-1')
        expect(hook.dispose).not.toHaveBeenCalled()
        await artifacts.dispose()
        expect(hook.dispose).toHaveBeenCalledTimes(1)
      } finally {
        await closeServer(daemon)
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it.skipIf(process.platform === 'win32')(
    'keeps legacy --config injection when no daemon socket answers',
    async () => {
      const hook = channel('codex')
      const artifacts = new AgentLaunchArtifactScope()
      const root = await mkdtemp('/tmp/opencove-codex-daemon-')
      const socketPath = join(root, 'app-server-control', 'app-server-control.sock')
      await mkdir(dirname(socketPath), { recursive: true })
      const provider = new CodexAgentProviderContribution({
        channel: hook.channel,
        detector,
        runtimeExecutable: '/runtime/node',
        runtimePlatform: 'linux',
      })

      try {
        const plan = await provider.launcher.createLaunchPlan(
          launchCommand(artifacts, { CODEX_HOME: root }),
        )
        artifacts.seal()

        expect(plan.args.join('\n')).toContain('notify=["/runtime/node"')
        expect(plan.hookInstallState).toBe('installed')
        await artifacts.dispose()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('uses platform-safe TOML strings', () => {
    expect(serializeCodexTomlString('C:\\Open Cove\\relay.mjs', 'win32')).toBe(
      "'C:\\Open Cove\\relay.mjs'",
    )
    expect(serializeCodexTomlStringArray(['a', 'C:\\b'], 'win32')).toBe("['a','C:\\b']")
    expect(serializeCodexTomlString("line\nwith 'quote", 'linux')).toBe('"line\\nwith \'quote"')
  })
})
