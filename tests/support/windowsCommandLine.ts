// Independent receiver-side implementation of Microsoft's C startup argument rules:
// https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments
// This parses arguments only, not argv[0]'s distinct executable-path grammar.
export function parseWindowsArguments(commandLine: string): string[] {
  const args: string[] = []
  let i = 0
  while (i < commandLine.length) {
    while (commandLine[i] === ' ' || commandLine[i] === '\t') {
      i++
    }
    if (i === commandLine.length) {
      break
    }
    let value = '',
      quoted = false
    while (i < commandLine.length && (quoted || !' \t'.includes(commandLine[i]))) {
      let slashes = 0
      while (commandLine[i] === '\\') {
        slashes++
        i++
      }
      if (commandLine[i] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2))
        if (slashes % 2) {
          value += '"'
          i++
        } else if (quoted && commandLine[i + 1] === '"') {
          value += '"'
          i += 2
        } else {
          quoted = !quoted
          i++
        }
      } else {
        value += '\\'.repeat(slashes)
        if (i < commandLine.length) {
          value += commandLine[i++]
        }
      }
    }
    args.push(value)
  }
  return args
}
