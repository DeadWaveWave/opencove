import { serializeWindowsArguments } from '../process/windowsCommandLine'
import { npmNodeCmdPattern, npmNodePs1Pattern } from './windowsNpmShim'

function encodedValue(value: string): string {
  return `[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(value, 'utf16le').toString('base64')}'))`
}

/** Bypass every version/mode of PowerShell native argument binding. */
export function buildPowerShellExecLaunch(
  command: string,
  args: string[],
  cwd: string,
): { args: string[]; env: Record<string, string> } {
  const script = [
    '$ErrorActionPreference = "Stop"',
    "$requested = [Environment]::GetEnvironmentVariable('OPENCOVE_NATIVE_COMMAND')",
    "$arguments = [Environment]::GetEnvironmentVariable('OPENCOVE_NATIVE_ARGUMENTS')",
    "$directory = [Environment]::GetEnvironmentVariable('OPENCOVE_NATIVE_CWD')",
    "foreach ($key in @('OPENCOVE_NATIVE_COMMAND','OPENCOVE_NATIVE_ARGUMENTS','OPENCOVE_NATIVE_CWD')) { [Environment]::SetEnvironmentVariable($key, $null) }",
    'Set-Location -LiteralPath $directory',
    // Script wrappers are data: verify the complete npm template, never invoke their parser.
    'if ($requested.Contains("\\") -or $requested.Contains("/")) {',
    '  $native = (Get-Item -LiteralPath $requested -ErrorAction Stop).FullName',
    '} else {',
    '  $native = (Get-Command -Name ([Management.Automation.WildcardPattern]::Escape($requested)) -CommandType Application,ExternalScript -ErrorAction Stop | Select-Object -First 1).Path',
    '}',
    '$extension = [IO.Path]::GetExtension($native).ToLowerInvariant()',
    'if (@(".cmd", ".ps1") -contains $extension) {',
    '  $source = [IO.File]::ReadAllText($native).Replace("`r`n", "`n")',
    `  $pattern = if ($extension -eq '.cmd') { ${encodedValue(npmNodeCmdPattern)} } else { ${encodedValue(npmNodePs1Pattern)} }`,
    '  $match = [regex]::Match($source, $pattern)',
    '  if (-not $match.Success) { throw "This command wrapper cannot preserve prompt text. Select a native executable or reinstall the CLI with a standard npm installation." }',
    '  $directory = [IO.Path]::GetDirectoryName($native)',
    '  $target = [IO.Path]::GetFullPath([IO.Path]::Combine($directory, $match.Groups["target"].Value))',
    '  if (-not [IO.File]::Exists($target)) { throw "The CLI entry point is missing. Reinstall the CLI and try again." }',
    '  $native = [IO.Path]::Combine($directory, "node.exe")',
    '  if (-not [IO.File]::Exists($native)) { $native = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Path }',
    // Paths cannot contain quotes on Windows. Quoted trailing slash rules still apply.
    String.raw`  $arguments = '"' + [regex]::Replace($target, '(\\+)$', '$1$1') + '" ' + $arguments`,
    '}',
    'if (@(".exe", ".com") -notcontains [IO.Path]::GetExtension($native).ToLowerInvariant()) {',
    '  throw "This command wrapper cannot preserve prompt text. Select a native executable or reinstall the CLI with a standard npm installation."',
    '}',
    '$start = New-Object System.Diagnostics.ProcessStartInfo',
    '$start.FileName = $native',
    '$start.Arguments = $arguments',
    '$start.WorkingDirectory = (Get-Location).ProviderPath',
    '$start.UseShellExecute = $false',
    // No redirection/CreateNoWindow: preserve the ConPTY console and inherited standard handles.
    '$child = [Diagnostics.Process]::Start($start)',
    'try { $child.WaitForExit(); $code = $child.ExitCode } finally { $child.Dispose() }',
    'exit $code',
  ].join('\n')
  return {
    args: ['-NoLogo', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    env: {
      OPENCOVE_NATIVE_COMMAND: command,
      OPENCOVE_NATIVE_ARGUMENTS: serializeWindowsArguments(args),
      OPENCOVE_NATIVE_CWD: cwd,
    },
  }
}

/** Windows environment keys are case-insensitive, including caller-configured collisions. */
export function mergePowerShellLaunchEnv(
  base: NodeJS.ProcessEnv,
  transport: Record<string, string>,
): NodeJS.ProcessEnv {
  const owned = new Set(Object.keys(transport).map(key => key.toUpperCase()))
  return {
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !owned.has(key.toUpperCase()))),
    ...transport,
  }
}
