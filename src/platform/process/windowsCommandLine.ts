/** Win32 CRT quoting, including data that already starts/ends in a quote. */
export function quoteWindowsArgument(value: string): string {
  if (value.includes('\0')) {
    throw new Error('Command arguments cannot contain a null character.')
  }
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/** Pass this string to node-pty to bypass its lossy already-quoted heuristic. */
export function serializeWindowsArguments(args: readonly string[]): string {
  return args.map(quoteWindowsArgument).join(' ')
}
