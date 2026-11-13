import { createAppError } from '../../shared/errors/appError'
import { terminalSpawnApplicationDescriptor } from '../../shared/errors/terminalSpawnErrorReasons'
import { quoteWindowsArgument } from './windowsCommandLine'

function unsupported(): never {
  throw createAppError(terminalSpawnApplicationDescriptor('wsl_arguments_unsupported'))
}

/** WslMain scans raw options, then CommandLineToArgvW parses only the --exec suffix. */
export function serializeWslArguments(args: readonly string[]): string {
  const encoded: string[] = []
  let valueFor: string | undefined
  for (let i = 0; i < args.length; i++) {
    const value = args[i]
    if (!valueFor && (value === '--exec' || value === '-e')) {
      const executable = args[i + 1]
      if (!executable || executable.includes('"')) {
        unsupported()
      }
      // CommandLineToArgvW treats argv[0] as a path, without backslash escaping.
      encoded.push(value, `"${executable}"`, ...args.slice(i + 2).map(quoteWindowsArgument))
      return encoded.join(' ')
    }
    if (valueFor === '--cd') {
      // ParseArgument(..., true) stops at the first closing quote; it has no escape syntax.
      if (!value || /["\r\n]/u.test(value)) {
        unsupported()
      }
      encoded.push(/[ \t]/u.test(value) ? `"${value}"` : value)
    } else {
      // Distribution/user names and the switches themselves are scanned without dequoting.
      if (!value || /[ \t\r\n"]/u.test(value)) {
        unsupported()
      }
      encoded.push(value)
    }
    valueFor = valueFor
      ? undefined
      : [
            '--distribution',
            '-d',
            '--user',
            '-u',
            '--distribution-id',
            '--cd',
            '--shell-type',
          ].includes(value)
        ? value
        : undefined
  }
  return encoded.join(' ')
}
