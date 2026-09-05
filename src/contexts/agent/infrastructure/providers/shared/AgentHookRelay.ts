import type { CreateAgentLaunchPlanCommand } from '../../../application/ports/AgentProviderContribution'
import { createTemporaryProviderConfig } from './TemporaryProviderConfig'

export interface AgentHookRelayInvocation {
  readonly command: string
  readonly args: string[]
  readonly shellCommand: string
}

export async function createAgentHookRelay(options: {
  provider: 'codex' | 'claude'
  runtimeExecutable: string
  runtimePlatform: NodeJS.Platform
  artifacts: CreateAgentLaunchPlanCommand['artifacts']
}): Promise<AgentHookRelayInvocation> {
  const { provider, runtimeExecutable, runtimePlatform, artifacts } = options
  const relay = await createTemporaryProviderConfig(
    `opencove-${provider}-hook-`,
    'relay.mjs',
    `const provider = ${JSON.stringify(provider)};\n${relayScript}`,
  )
  artifacts.track(`${provider}-hook-relay`, relay)

  // The hook owns Electron's mode. The provider/terminal environment is deliberately sanitized.
  if (runtimePlatform !== 'win32') {
    const command = '/usr/bin/env'
    const args = ['ELECTRON_RUN_AS_NODE=1', runtimeExecutable, relay.path]
    return { command, args, shellCommand: [command, ...args].map(quotePosix).join(' ') }
  }

  const launcher = await createTemporaryProviderConfig(
    `opencove-${provider}-hook-`,
    'launch.ps1',
    createWindowsLauncher(runtimeExecutable, relay.path),
  )
  artifacts.track(`${provider}-hook-launcher`, launcher)
  const command = 'powershell.exe'
  const flags = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']
  // File mode forwards Codex notify's appended JSON as data, never PowerShell source.
  const args = [...flags, '-File', launcher.path]
  const script = `& ${decodePowerShellPath(launcher.path)}`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return { command, args, shellCommand: [command, ...flags, '-EncodedCommand', encoded].join(' ') }
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function decodePowerShellPath(value: string): string {
  return `([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(value, 'utf8').toString('base64')}')))`
}

function createWindowsLauncher(runtime: string, relay: string): string {
  return [
    '$ErrorActionPreference = "Stop"',
    // ProcessStartInfo avoids PowerShell 5.1's lossy native argument marshalling for JSON.
    'function Quote-NativeArgument([string] $value) {',
    String.raw`  return '"' + [regex]::Replace([regex]::Replace($value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'`,
    '}',
    '$start = New-Object System.Diagnostics.ProcessStartInfo',
    `$start.FileName = ${decodePowerShellPath(runtime)}`,
    `$relay = ${decodePowerShellPath(relay)}`,
    '$nativeArgs = @($relay) + @($args)',
    '$start.Arguments = ($nativeArgs | ForEach-Object { Quote-NativeArgument $_ }) -join " "',
    '$start.UseShellExecute = $false',
    '$start.CreateNoWindow = $true',
    // Electron is a GUI-subsystem executable on Windows; inherited console stdin is not reliable.
    '$start.RedirectStandardInput = $true',
    '$start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1"',
    '$child = [System.Diagnostics.Process]::Start($start)',
    'try {',
    '  $copy = [Console]::OpenStandardInput().CopyToAsync($child.StandardInput.BaseStream)',
    '  $inputClosed = $false',
    '  while (-not $child.WaitForExit(20)) {',
    '    if (-not $inputClosed -and $copy.IsCompleted) {',
    '      $child.StandardInput.Close()',
    '      $inputClosed = $true',
    '    }',
    '  }',
    '  $exitCode = $child.ExitCode',
    '} finally { $child.Dispose() }',
    'exit $exitCode',
  ].join('\n')
}

const relayScript = String.raw`
// Telemetry cannot keep the provider waiting, including on an unclosed stdin or socket.
const deadline = setTimeout(() => process.exit(0), 2000);
try {
  const prefix = provider === 'codex' ? 'OPENCOVE_CODEX_HOOK_' : 'OPENCOVE_CLAUDE_HOOK_';
  const endpoint = process.env[prefix + 'ENDPOINT'];
  const token = process.env[prefix + 'TOKEN'];
  if (endpoint && token) {
    let body = provider === 'codex' && process.argv.length > 2 ? process.argv.at(-1) : '';
    if (!body) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > 256 * 1024) process.exit(0);
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.byteLength(body, 'utf8') > 256 * 1024) process.exit(0);
    if (provider === 'codex') {
      const value = JSON.parse(body);
      if (!value.hook_event_name && value.type === 'agent-turn-complete') {
        body = JSON.stringify({ version: 1, state: 'done', hookEventName: 'notify', codexSessionId: value['thread-id'] ?? 'unknown' });
      }
    }
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-opencove-hook-token': token },
      body,
      signal: AbortSignal.timeout(1500),
    });
  }
} catch {
  // The receiver owns validation and fallback; a failed observation is not an agent failure.
} finally {
  clearTimeout(deadline);
  process.exit(0);
}
`
