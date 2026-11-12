import { createRequire } from 'node:module'
import { preparePtySpawnArguments } from '../../src/platform/process/spawnArguments'
import { parseWindowsArguments } from './windowsCommandLine'
const require = createRequire(import.meta.url)
const { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent.js') as {
  argsToCommandLine(file: string, args: string | string[]): string
}
export function windowsSpawnCommandLine(command: string, args: string[]): string {
  return argsToCommandLine(command, preparePtySpawnArguments(command, args, undefined, 'win32'))
}
/** Same final transport as ptyHost/entry, through node-pty's actual serializer. */
export function receiveWindowsSpawn(command: string, args: string[]): string[] {
  return parseWindowsArguments(windowsSpawnCommandLine(command, args))
}
export function receivePowerShellSpawn(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): string[] {
  const invocation = receiveWindowsSpawn(command, args)
  if (invocation[2] !== '-EncodedCommand') {
    throw new Error('PowerShell would use native binding')
  }
  const script = Buffer.from(invocation[3], 'base64').toString('utf16le')
  // ProcessStartInfo.Arguments goes straight to CreateProcess, not the PS native binder.
  if (
    !script.includes('$start.Arguments = $arguments') ||
    !script.includes('$start.UseShellExecute = $false')
  ) {
    throw new Error('Missing direct native launch')
  }
  if (
    !script.includes("[Environment]::GetEnvironmentVariable('OPENCOVE_NATIVE_ARGUMENTS')") ||
    !script.includes('[Environment]::SetEnvironmentVariable($key, $null)')
  ) {
    throw new Error('Missing private environment transport')
  }
  return [env.OPENCOVE_NATIVE_COMMAND!, ...parseWindowsArguments(env.OPENCOVE_NATIVE_ARGUMENTS!)]
}
