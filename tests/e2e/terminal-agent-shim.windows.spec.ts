import { spawn as spawnChild } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { createClaudeHookChannel } from '../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { createCodexHookChannel } from '../../src/app/main/controlSurface/agentHook/codexHookChannel'
import { ClaudeCodeAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { CodexAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { TerminalAgentActivityGateway } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { TerminalAgentActivityEnvironmentService } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'
import type { AgentHookChannel } from '../../src/shared/runtime/agentHook/agentHookChannel'
import type {
  TerminalAgentShimProvider,
  TerminalSessionMetadataEvent,
} from '../../src/shared/contracts/dto'
import { reportWindowsShimFailure } from './terminal-agent-shim.windows.diagnostics'

const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'gu')

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
}

function outputLines(output: string): string[] {
  return output
    .replaceAll(ANSI_ESCAPE_PATTERN, '')
    .split(/\r?\n/u)
    .map(line => line.trim())
}

async function waitForOutput(read: () => string, expectedLine: string): Promise<void> {
  await expect
    .poll(() => outputLines(read()).includes(expectedLine), { timeout: 10_000 })
    .toBe(true)
}

async function createProviderCommand(options: {
  root: string
  provider: TerminalAgentShimProvider
  exitCode: number
}): Promise<{ command: 'claude' | 'codex'; realBin: string }> {
  const command = options.provider === 'claude-code' ? 'claude' : 'codex'
  const realBin = join(options.root, 'real provider bin')
  const helperName = `${command}-provider.mjs`
  const helperPath = join(realBin, helperName)
  await mkdir(realBin)
  await writeFile(
    helperPath,
    [
      "import { writeFileSync } from 'node:fs'",
      `const provider = ${JSON.stringify(options.provider)}`,
      'const args = process.argv.slice(2)',
      "if (args.includes('app-server')) {",
      "  process.stdin.setEncoding('utf8')",
      "  let input = ''",
      "  process.stdin.on('data', chunk => {",
      '    input += chunk',
      "    let newline = input.indexOf('\\n')",
      '    while (newline >= 0) {',
      '      const message = JSON.parse(input.slice(0, newline))',
      '      input = input.slice(newline + 1)',
      "      const result = message.method === 'hooks/list' ? { data: [] } : {}",
      "      if (message.id) process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n')",
      "      newline = input.indexOf('\\n')",
      '    }',
      '  })',
      '} else {',
      "  const claude = provider === 'claude-code'",
      "  const endpoint = process.env[claude ? 'OPENCOVE_CLAUDE_HOOK_ENDPOINT' : 'OPENCOVE_CODEX_HOOK_ENDPOINT']",
      "  const token = process.env[claude ? 'OPENCOVE_CLAUDE_HOOK_TOKEN' : 'OPENCOVE_CODEX_HOOK_TOKEN']",
      "  const sessionId = process.env.OPENCOVE_WINDOWS_PROVIDER_SESSION_ID || 'missing'",
      "  const body = claude ? { version: 1, state: 'working', hookEventName: 'SessionStart', claudeSessionId: sessionId } : { version: 1, state: 'working', hookEventName: 'SessionStart', codexSessionId: sessionId }",
      "  const response = endpoint && token ? await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opencove-hook-token': token }, body: JSON.stringify(body) }) : { status: 0 }",
      "  process.stdout.write('HOOK_STATUS=' + response.status + '\\n')",
      "  process.stdout.write('ARGS_JSON=' + JSON.stringify(args) + '\\n')",
      "  process.stdout.write('ELECTRON_RUN_AS_NODE=' + (process.env.ELECTRON_RUN_AS_NODE || '') + '\\n')",
      '  if (process.env.OPENCOVE_WINDOWS_CTRL_C_MARKER) {',
      "    process.on('SIGINT', () => { writeFileSync(process.env.OPENCOVE_WINDOWS_CTRL_C_MARKER, 'SIGINT'); process.stdout.write('CHILD_SIGINT\\n'); process.exit(130) })",
      "    process.stdout.write('CTRL_C_READY\\n')",
      '    setInterval(() => {}, 1000)',
      '  } else {',
      `    process.exitCode = ${String(options.exitCode)}`,
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(realBin, `${command}.cmd`),
    `@echo off\r\n"${process.execPath}" "%~dp0${helperName}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
  )
  return { command, realBin }
}

async function createHarness(options: { provider: TerminalAgentShimProvider; ctrlC?: boolean }) {
  const commandExitCode = options.provider === 'claude-code' ? 37 : 41
  const root = await mkdtemp(join(tmpdir(), 'OpenCove Windows 路径 with spaces '))
  const fixture = await createProviderCommand({
    root,
    provider: options.provider,
    exitCode: commandExitCode,
  })
  const channel: AgentHookChannel =
    options.provider === 'claude-code' ? createClaudeHookChannel({}) : createCodexHookChannel({})
  await channel.start()
  const contribution =
    options.provider === 'claude-code'
      ? new ClaudeCodeAgentProviderContribution({ channel, runtimeExecutable: process.execPath })
      : new CodexAgentProviderContribution({
          channel,
          runtimeExecutable: process.execPath,
          runtimePlatform: 'win32',
        })
  const plans: Array<{ args: readonly string[] }> = []
  const gateway = new TerminalAgentActivityGateway({
    resolveHookInjection: provider =>
      provider === options.provider
        ? {
            prepareHookInjection: async command => {
              const plan = await contribution.hookInjection.prepareHookInjection(command)
              plans.push(plan)
              return plan
            },
          }
        : null,
  })
  const assets = new TerminalAgentTelemetryAssetStore({
    runtimeExecutable: process.execPath,
    platform: 'win32',
  })
  const service = new TerminalAgentActivityEnvironmentService({
    assets,
    gateway,
    inheritedPath: process.env.PATH ?? '',
    inheritedShell: 'powershell.exe',
    platform: 'win32',
  })
  const home = join(root, 'user home')
  const profileDirectory = join(home, 'Documents', 'WindowsPowerShell')
  const profilePath = join(profileDirectory, 'Microsoft.PowerShell_profile.ps1')
  await mkdir(profileDirectory, { recursive: true })
  const profileBytes = Buffer.from("$env:USER_PROFILE_SENTINEL = 'loaded'\r\n", 'utf8')
  await writeFile(profilePath, profileBytes)
  const ctrlCMarker = join(root, 'ctrl-c.marker')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.PATH = `${fixture.realBin}${delimiter}${process.env.PATH ?? ''}`
  env.HOME = home
  env.USERPROFILE = home
  env.OPENCOVE_WINDOWS_PROVIDER_SESSION_ID = `${fixture.command}-session-精确`
  if (options.ctrlC) {
    env.OPENCOVE_WINDOWS_CTRL_C_MARKER = ctrlCMarker
  }
  const prepared = await service.prepare({
    args: [],
    command: 'powershell.exe',
    cwd: root,
    environment: env,
    interactiveShell: true,
    runtimeKind: 'windows',
  })
  prepared.commit(`pty-${fixture.command}`)
  const published = await assets.ensure()
  prepared.environment!.PATH = [
    published.shimDirectory.toUpperCase(),
    published.shimDirectory,
    fixture.realBin,
    process.env.PATH ?? '',
  ].join(delimiter)
  const metadata: TerminalSessionMetadataEvent[] = []
  const unsubscribers = [
    gateway.onMetadata(event => metadata.push(event)),
    channel.onMetadata(event => metadata.push(event)),
  ]
  return {
    assets,
    channel,
    command: fixture.command,
    commandExitCode,
    ctrlCMarker,
    gateway,
    metadata,
    plans,
    prepared,
    profileBytes,
    profilePath,
    published,
    root,
    dispose: async () => {
      unsubscribers.forEach(dispose => dispose())
      await prepared.dispose()
      await Promise.all([gateway.dispose(), channel.dispose(), assets.dispose()])
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function expectPrivateCleanup(harness: Awaited<ReturnType<typeof createHarness>>) {
  expect(await readdir(harness.published.planDirectory)).toEqual([])
  const args = harness.plans.at(-1)?.args ?? []
  const directArtifact = args.find(argument =>
    /opencove-claude-settings-.*settings\.json/iu.test(argument),
  )
  if (harness.command === 'claude') {
    expect(directArtifact).toBeTruthy()
    await expect(access(directArtifact!)).rejects.toMatchObject({ code: 'ENOENT' })
  }
  const relayMatch = args
    .join('\n')
    .match(/[A-Za-z]:\\[^'"\n]*opencove-codex-hook-[^'"\n]*\\relay\.mjs/iu)
  if (harness.command === 'codex') {
    expect(relayMatch).toBeTruthy()
    await expect(access(relayMatch![0])).rejects.toMatchObject({ code: 'ENOENT' })
  }
}

test.describe('terminal Agent shim (Windows)', () => {
  test.skip(process.platform !== 'win32', 'Windows command-shim contract')

  for (const provider of ['claude-code', 'codex'] as const) {
    for (const invocation of ['cmd', 'powershell'] as const) {
      test(`${provider} via ${invocation} preserves production identity, exact args, exit, profile, and cleanup`, async ({
        browserName: _browserName,
      }, testInfo) => {
        const harness = await createHarness({ provider })
        const args = ['argument with spaces', '参数-🌊']
        const command =
          invocation === 'cmd'
            ? {
                executable: 'cmd.exe',
                args: ['/d', '/s', '/c', `${harness.command} "${args[0]}" "${args[1]}"`],
                cwd: harness.root,
              }
            : {
                executable: 'powershell.exe',
                args: [
                  '-NoLogo',
                  '-ExecutionPolicy',
                  'Bypass',
                  '-File',
                  join(harness.published.shimDirectory, `${harness.command}.ps1`),
                  ...args,
                ],
                cwd: harness.root,
              }
        let result: Awaited<ReturnType<typeof run>> | null = null
        try {
          result = await run(command.executable, command.args, {
            cwd: command.cwd,
            env: harness.prepared.environment!,
          })

          expect(result.code).toBe(harness.commandExitCode)
          expect(result.stdout).toContain('HOOK_STATUS=204')
          expect(result.stdout).toContain('ELECTRON_RUN_AS_NODE=1')
          const serializedArgs = result.stdout.match(/ARGS_JSON=(\[[^\r\n]+\])/u)?.[1]
          expect(serializedArgs).toBeTruthy()
          expect(JSON.parse(serializedArgs!)).toEqual(expect.arrayContaining(args))
          await expect
            .poll(() =>
              harness.metadata.some(
                event =>
                  event.resumeSessionId !== null &&
                  event.terminalAgentActivity !== null &&
                  event.terminalAgentActivity !== undefined,
              ),
            )
            .toBe(true)
          expect(harness.metadata).toContainEqual(
            expect.objectContaining({
              sessionId: `pty-${harness.command}`,
              resumeSessionId: `${harness.command}-session-精确`,
              terminalAgentActivity: expect.objectContaining({
                provider,
                identityAuthority: 'provider_session_start',
              }),
            }),
          )
          expect(await readFile(harness.profilePath)).toEqual(harness.profileBytes)
          await expectPrivateCleanup(harness)
        } catch (error) {
          await reportWindowsShimFailure(testInfo, {
            command,
            exitCode: result?.code ?? null,
            launcherPath: harness.published.launcherPath,
            planDirectory: harness.published.planDirectory,
            providerCommand: harness.command,
            shimDirectory: harness.published.shimDirectory,
            stderr: result?.stderr ?? '',
            stdout: result?.stdout ?? '',
          })
          throw error
        } finally {
          await harness.dispose()
        }
      })
    }
  }

  test('gateway fail-open leaves ELECTRON_RUN_AS_NODE absent for the real provider', async ({
    browserName: _browserName,
  }, testInfo) => {
    const harness = await createHarness({ provider: 'claude-code' })
    const command = {
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', 'claude fail-open'],
      cwd: harness.root,
    }
    let result: Awaited<ReturnType<typeof run>> | null = null
    try {
      await harness.gateway.dispose()
      result = await run(command.executable, command.args, {
        cwd: command.cwd,
        env: harness.prepared.environment!,
      })
      expect(result.stdout).toContain('ELECTRON_RUN_AS_NODE=')
      expect(result.stdout).not.toContain('ELECTRON_RUN_AS_NODE=1')
    } catch (error) {
      await reportWindowsShimFailure(testInfo, {
        command,
        exitCode: result?.code ?? null,
        launcherPath: harness.published.launcherPath,
        planDirectory: harness.published.planDirectory,
        providerCommand: harness.command,
        shimDirectory: harness.published.shimDirectory,
        stderr: result?.stderr ?? '',
        stdout: result?.stdout ?? '',
      })
      throw error
    } finally {
      await harness.dispose()
    }
  })

  test('Ctrl-C reaches the provider, cleans plans, and leaves the PowerShell host reusable', async ({
    browserName: _browserName,
  }, testInfo) => {
    const harness = await createHarness({ provider: 'claude-code', ctrlC: true })
    const command = {
      executable: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile'],
      cwd: harness.root,
    }
    const ptyWrites: string[] = []
    let output = ''
    let pty: IPty | null = null
    let ptyExitCode: number | null = null
    let ptyExit: Promise<void> | null = null
    try {
      pty = spawnPty(command.executable, command.args, {
        cwd: command.cwd,
        env: harness.prepared.environment as Record<string, string>,
        cols: 100,
        rows: 30,
      })
      pty.onData(data => (output += data))
      ptyExit = new Promise(resolve => {
        pty!.onExit(event => {
          ptyExitCode = event.exitCode
          resolve()
        })
      })
      const shim = join(harness.published.shimDirectory, 'claude.ps1').replaceAll("'", "''")
      const providerInvocation = `& '${shim}' 'ctrl-c-case'\r`
      ptyWrites.push(providerInvocation)
      pty.write(providerInvocation)
      await waitForOutput(() => output, 'CTRL_C_READY')
      expect(outputLines(output)).toContain('CTRL_C_READY')
      const ctrlC = '\u0003'
      ptyWrites.push(ctrlC)
      pty.write(ctrlC)
      await waitForOutput(() => output, 'CHILD_SIGINT')
      expect(outputLines(output)).toContain('CHILD_SIGINT')
      const batchConfirmation = 'Terminate batch job (Y/N)?'
      await waitForOutput(() => output, batchConfirmation)
      expect(outputLines(output)).toContain(batchConfirmation)
      const batchCompletionOutputStart = output.length
      const batchConfirmationAnswer = 'Y\r'
      // Y answers cmd.exe's real batch confirmation rather than hiding or bypassing it.
      ptyWrites.push(batchConfirmationAnswer)
      pty.write(batchConfirmationAnswer)
      await expect
        .poll(async () => ({
          planDirectoryEmpty: (await readdir(harness.published.planDirectory)).length === 0,
          shellPromptReady: outputLines(output.slice(batchCompletionOutputStart)).some(line =>
            /^PS .+>$/u.test(line),
          ),
        }))
        .toEqual({ planDirectoryEmpty: true, shellPromptReady: true })
      expect(await readdir(harness.published.planDirectory)).toEqual([])
      const reuseProbe = "Write-Output 'SHELL_REUSED'\r"
      ptyWrites.push(reuseProbe)
      pty.write(reuseProbe)
      await waitForOutput(() => output, 'SHELL_REUSED')
      expect(outputLines(output)).toContain('SHELL_REUSED')
      const shellExit = 'exit\r'
      ptyWrites.push(shellExit)
      pty.write(shellExit)
      await ptyExit
      await expect(readFile(harness.ctrlCMarker, 'utf8')).resolves.toBe('SIGINT')
      expect(await readFile(harness.profilePath)).toEqual(harness.profileBytes)
    } catch (error) {
      await reportWindowsShimFailure(testInfo, {
        command,
        exitCode: ptyExitCode,
        launcherPath: harness.published.launcherPath,
        planDirectory: harness.published.planDirectory,
        providerCommand: harness.command,
        ptyOutput: output,
        ptyWrites,
        shimDirectory: harness.published.shimDirectory,
        stderr: '',
        stdout: output,
        streamNote:
          'node-pty exposes one combined PTY stream; normalizedStdout and normalizedPtyOutput contain it',
      })
      throw error
    } finally {
      await harness.dispose()
    }
  })

  test('invalid plan JSON still runs finally cleanup and returns control to PowerShell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'OpenCove invalid plan '))
    const fakeRuntime = join(root, 'fake-runtime.cmd')
    await writeFile(
      fakeRuntime,
      '@echo off\r\nif "%~2"=="--prepare-windows" (echo {invalid>"%~4" & exit /b 0)\r\nif "%~2"=="--complete-windows" (del /f /q "%~3" 2>nul & exit /b 0)\r\nexit /b 1\r\n',
    )
    const assets = new TerminalAgentTelemetryAssetStore({
      platform: 'win32',
      runtimeExecutable: fakeRuntime,
    })
    try {
      const published = await assets.ensure()
      const shim = join(published.shimDirectory, 'claude.ps1').replaceAll("'", "''")
      const result = await run(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          `& '${shim}'; Write-Output 'SHELL_REUSED_AFTER_PARSE_FAILURE'`,
        ],
        { cwd: root, env: { ...process.env } },
      )
      expect(result.stdout).toContain('SHELL_REUSED_AFTER_PARSE_FAILURE')
      expect(await readdir(published.planDirectory)).toEqual([])
    } finally {
      await assets.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
