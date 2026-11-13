import { createAppError } from '../../shared/errors/appError'
import { terminalSpawnApplicationDescriptor } from '../../shared/errors/terminalSpawnErrorReasons'
import { serializeWindowsArguments } from './windowsCommandLine'
import { serializeWslArguments } from './wslCommandLine'

/** Every native platform terminates argv, executable names and cwd at NUL. */
export function assertSpawnArguments(command: string, args: readonly string[], cwd?: string): void {
  if ([command, ...args, cwd ?? ''].some(value => value.includes('\0'))) {
    throw createAppError(terminalSpawnApplicationDescriptor('invalid_spawn_arguments'))
  }
}

/** Final PTY transport; string[] on POSIX, a preescaped command line on Windows. */
export function preparePtySpawnArguments(
  command: string,
  args: string[],
  cwd: string | undefined,
  platform = process.platform,
): string[] | string {
  assertSpawnArguments(command, args, cwd)
  if (platform !== 'win32') {
    return args
  }
  const executable = command.split(/[\\/]/u).at(-1)?.toLowerCase()
  return executable === 'wsl.exe' || executable === 'wsl'
    ? serializeWslArguments(args)
    : serializeWindowsArguments(args)
}
