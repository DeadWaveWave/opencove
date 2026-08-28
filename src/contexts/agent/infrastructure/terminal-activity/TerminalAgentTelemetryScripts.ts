import { posix } from 'node:path'

export const terminalAgentLauncherScript = String.raw`
import { accessSync, constants, realpathSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { delimiter, join, resolve } from 'node:path';

const operation = process.argv[2];
if (operation === '--prepare-windows') await prepareWindows(process.argv[3], process.argv[4]);
else if (operation === '--complete-windows') await completeWindows(process.argv[3]);
else await launch(operation, process.argv.slice(3));

async function launch(providerArgument, userArgs) {
  const provider = normalizeProvider(providerArgument);
  const executable = findExecutable(providerCommand(provider), ownShimDirectory());
  if (!executable) {
    process.stderr.write('OpenCove could not resolve the real ' + providerCommand(provider) + ' executable.\n');
    process.exitCode = 127;
    return;
  }
  const invocationId = randomUUID();
  const plan = await prepare(provider, executable, invocationId);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  Object.assign(environment, plan?.env || {});
  const child = spawn(executable, [...(plan?.args || []), ...userArgs], {
    env: environment,
    stdio: 'inherit',
    windowsHide: false
  });
  const signals = ['SIGHUP', 'SIGINT', 'SIGTERM'];
  const handlers = new Map();
  for (const signal of signals) {
    const handler = () => {
      try { child.kill(signal); } catch {}
    };
    handlers.set(signal, handler);
    try { process.on(signal, handler); } catch {}
  }
  const result = await new Promise((resolveResult) => {
    child.once('error', () => resolveResult({ code: 127, signal: null }));
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  });
  for (const [signal, handler] of handlers) {
    try { process.off(signal, handler); } catch {}
  }
  if (plan) await complete(invocationId, plan.generation);
  process.exitCode = result.code ?? signalExitCode(result.signal);
}

async function prepareWindows(providerArgument, planPath) {
  const provider = normalizeProvider(providerArgument);
  const executable = findExecutable(providerCommand(provider), ownShimDirectory());
  if (!executable || !planPath) process.exit(127);
  const invocationId = randomUUID();
  const plan = await prepare(provider, executable, invocationId);
  writeFileSync(planPath, JSON.stringify({
    executable,
    args: plan?.args || [],
    env: plan?.env || {},
    endpoint: process.env.OPENCOVE_TERMINAL_AGENT_ENDPOINT || '',
    token: process.env.OPENCOVE_TERMINAL_AGENT_TOKEN || '',
    invocationId,
    generation: plan?.generation || null
  }), { encoding: 'utf8', mode: 0o600 });
}

async function completeWindows(planPath) {
  if (!planPath) return;
  try {
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    if (plan.generation) await reportComplete(plan.endpoint, plan.token, plan.invocationId, plan.generation);
  } catch {}
  try { unlinkSync(planPath); } catch {}
}

async function prepare(provider, executablePath, invocationId) {
  const endpoint = process.env.OPENCOVE_TERMINAL_AGENT_ENDPOINT;
  const token = process.env.OPENCOVE_TERMINAL_AGENT_TOKEN;
  if (!endpoint || !token) return null;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-opencove-terminal-agent-token': token },
      body: JSON.stringify({
        operation: 'prepare', provider, invocationId, cwd: process.cwd(), executablePath
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const value = await response.json();
    if (!value || value.ok !== true || !Array.isArray(value.args) || !validEnv(value.env) ||
        !Number.isSafeInteger(value.generation) || value.generation < 1) return null;
    if (!value.args.every((argument) => typeof argument === 'string')) return null;
    return { args: value.args, env: value.env, generation: value.generation };
  } catch { return null; }
}

async function complete(invocationId, generation) {
  await reportComplete(
    process.env.OPENCOVE_TERMINAL_AGENT_ENDPOINT,
    process.env.OPENCOVE_TERMINAL_AGENT_TOKEN,
    invocationId,
    generation
  );
}

async function reportComplete(endpoint, token, invocationId, generation) {
  if (!endpoint || !token) return;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-opencove-terminal-agent-token': token },
      body: JSON.stringify({ operation: 'complete', invocationId, generation }),
      signal: AbortSignal.timeout(750)
    });
  } catch {}
}

function findExecutable(name, shimDirectory) {
  const entries = String(process.env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const directory of entries) {
    if (canonical(directory) === canonical(shimDirectory)) continue;
    for (const extension of extensions) {
      const candidate = join(directory, process.platform === 'win32' ? name + extension.toLowerCase() : name);
      try {
        accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

function canonical(value) {
  try { return normalizeCase(realpathSync(value)); }
  catch { return normalizeCase(resolve(value)); }
}

function normalizeCase(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function ownShimDirectory() { return process.env.OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY || ''; }
function normalizeProvider(value) {
  if (value === 'claude' || value === 'claude-code') return 'claude-code';
  if (value === 'codex') return 'codex';
  throw new Error('Unsupported terminal Agent provider.');
}
function providerCommand(provider) { return provider === 'claude-code' ? 'claude' : 'codex'; }
function validEnv(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string');
}
function signalExitCode(signal) {
  if (signal === 'SIGHUP') return 129;
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return signal ? 128 : 0;
}
`.trimStart()

export function createPosixShimScript(
  runtimeExecutable: string,
  launcherPath: string,
  providerCommand: 'claude' | 'codex',
): string {
  return [
    '#!/bin/sh',
    `exec env ELECTRON_RUN_AS_NODE=1 ${quotePosix(runtimeExecutable)} ${quotePosix(
      launcherPath,
    )} ${providerCommand} "$@"`,
    '',
  ].join('\n')
}

export function createPowerShellShimScript(
  runtimeExecutable: string,
  launcherPath: string,
  providerCommand: 'claude' | 'codex',
): string {
  const runtime = quotePowerShell(runtimeExecutable)
  const launcher = quotePowerShell(launcherPath)
  return [
    '$planPath = [System.IO.Path]::GetTempFileName()',
    '$originalElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE',
    '$env:ELECTRON_RUN_AS_NODE = "1"',
    `& ${runtime} ${launcher} --prepare-windows ${providerCommand} $planPath`,
    'if ($LASTEXITCODE -ne 0) { $prepareExitCode = $LASTEXITCODE; Remove-Item -LiteralPath $planPath -Force -ErrorAction SilentlyContinue; exit $prepareExitCode }',
    '$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json',
    'foreach ($property in $plan.env.PSObject.Properties) {',
    '  [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, "Process")',
    '}',
    'if ($null -eq $originalElectronRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue } else { $env:ELECTRON_RUN_AS_NODE = $originalElectronRunAsNode }',
    '& $plan.executable @($plan.args) @args',
    '$providerExitCode = $LASTEXITCODE',
    '$env:ELECTRON_RUN_AS_NODE = "1"',
    `& ${runtime} ${launcher} --complete-windows $planPath`,
    'exit $providerExitCode',
    '',
  ].join('\r\n')
}

export function createCmdShimScript(powerShellShimPath: string): string {
  return [
    '@echo off',
    `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${powerShellShimPath}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
}

export const terminalAgentPosixShellLauncherScript = [
  '#!/bin/sh',
  'real_shell=${OPENCOVE_TERMINAL_AGENT_REAL_SHELL:-${SHELL:-/bin/sh}}',
  'shell_name=${real_shell##*/}',
  'case "$shell_name" in',
  '  bash)',
  '    exec "$real_shell" --noprofile --rcfile "$OPENCOVE_TERMINAL_AGENT_BASH_RC" -i "$@"',
  '    ;;',
  '  zsh)',
  '    export ZDOTDIR="$OPENCOVE_TERMINAL_AGENT_ZSH_DOT_DIRECTORY"',
  '    exec "$real_shell" -i "$@"',
  '    ;;',
  '  *) exec "$real_shell" "$@" ;;',
  'esac',
  '',
].join('\n')

export const terminalAgentBashRcScript = [
  '_opencove_user_bash_rc=${HOME:+$HOME/.bashrc}',
  'if [ -n "$_opencove_user_bash_rc" ] && [ -r "$_opencove_user_bash_rc" ] && [ "$_opencove_user_bash_rc" != "$OPENCOVE_TERMINAL_AGENT_BASH_RC" ]; then',
  '  . "$_opencove_user_bash_rc"',
  'fi',
  'if [ -n "$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY" ] && [ "${PATH%%:*}" != "$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY" ]; then',
  '  export PATH="$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY${PATH:+:$PATH}"',
  'fi',
  'unset _opencove_user_bash_rc',
  '',
].join('\n')

export const terminalAgentZshEnvScript = [
  '_opencove_wrapper_zdotdir=$OPENCOVE_TERMINAL_AGENT_ZSH_DOT_DIRECTORY',
  '_opencove_user_zdotdir=${OPENCOVE_TERMINAL_AGENT_ORIGINAL_ZDOTDIR:-${HOME:-}}',
  'if [ -n "$_opencove_user_zdotdir" ] && [ "$_opencove_user_zdotdir" != "$_opencove_wrapper_zdotdir" ] && [ -r "$_opencove_user_zdotdir/.zshenv" ]; then',
  '  export ZDOTDIR="$_opencove_user_zdotdir"',
  '  . "$_opencove_user_zdotdir/.zshenv"',
  '  _opencove_user_zdotdir=${ZDOTDIR:-${HOME:-}}',
  'fi',
  'if [ -n "$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY" ] && [ "${PATH%%:*}" != "$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY" ]; then',
  '  export PATH="$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY${PATH:+:$PATH}"',
  'fi',
  'export OPENCOVE_TERMINAL_AGENT_USER_ZDOTDIR="$_opencove_user_zdotdir"',
  'export ZDOTDIR="$_opencove_wrapper_zdotdir"',
  'unset _opencove_user_zdotdir _opencove_wrapper_zdotdir',
  '',
].join('\n')

export const terminalAgentZshProfileScript = createZshStartupRelay('.zprofile', true, false)
export const terminalAgentZshRcScript = createZshStartupRelay('.zshrc', true, true)
export const terminalAgentZshLoginScript = createZshStartupRelay('.zlogin', true, false)

function createZshStartupRelay(
  startupFile: string,
  prependShimPath: boolean,
  restoreOnlyForNonLogin: boolean,
): string {
  const userStartupPath = posix.join('$_opencove_user_zdotdir', startupFile)
  return [
    '_opencove_wrapper_zdotdir=$OPENCOVE_TERMINAL_AGENT_ZSH_DOT_DIRECTORY',
    '_opencove_user_zdotdir=${OPENCOVE_TERMINAL_AGENT_USER_ZDOTDIR:-${OPENCOVE_TERMINAL_AGENT_ORIGINAL_ZDOTDIR:-${HOME:-}}}',
    `if [ -n "$_opencove_user_zdotdir" ] && [ "$_opencove_user_zdotdir" != "$_opencove_wrapper_zdotdir" ] && [ -r "${userStartupPath}" ]; then`,
    '  export ZDOTDIR="$_opencove_user_zdotdir"',
    `  . "${userStartupPath}"`,
    '  _opencove_user_zdotdir=${ZDOTDIR:-$_opencove_user_zdotdir}',
    'fi',
    'export OPENCOVE_TERMINAL_AGENT_USER_ZDOTDIR="$_opencove_user_zdotdir"',
    ...(prependShimPath
      ? [
          'if [ -n "$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY" ] && [ "${PATH%%:*}" != "$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY" ]; then',
          '  export PATH="$OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY${PATH:+:$PATH}"',
          'fi',
        ]
      : []),
    ...(restoreOnlyForNonLogin
      ? [
          'if [[ ! -o login ]]; then export ZDOTDIR="$_opencove_user_zdotdir"; else export ZDOTDIR="$_opencove_wrapper_zdotdir"; fi',
        ]
      : [
          startupFile === '.zlogin'
            ? 'export ZDOTDIR="$_opencove_user_zdotdir"'
            : 'export ZDOTDIR="$_opencove_wrapper_zdotdir"',
        ]),
    'unset _opencove_user_zdotdir _opencove_wrapper_zdotdir',
    '',
  ].join('\n')
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
