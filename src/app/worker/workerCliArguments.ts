function readInlineValue(argv: readonly string[], flag: string): string | null {
  const prefix = `${flag}=`
  const argument = argv.find(value => value.startsWith(prefix))
  if (!argument) {
    return null
  }
  return argument.slice(prefix.length).trim() || null
}

export function readWorkerFlagValue(argv: readonly string[], flag: string): string | null {
  const inline = readInlineValue(argv, flag)
  if (inline !== null) {
    return inline
  }

  const index = argv.indexOf(flag)
  if (index === -1) {
    return null
  }

  const next = argv[index + 1]
  if (!next || next.startsWith('-')) {
    return null
  }

  return next.trim() || null
}

export function readRepeatedWorkerFlagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = []
  const prefix = `${flag}=`

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument?.startsWith(prefix)) {
      const inline = argument.slice(prefix.length).trim()
      if (inline) {
        values.push(inline)
      }
      continue
    }
    if (argument !== flag) {
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('-')) {
      continue
    }

    const normalized = next.trim()
    if (normalized) {
      values.push(normalized)
    }
  }

  return values
}
