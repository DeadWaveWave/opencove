import { jsonErrorOffset } from './jsonLocation'
import { parseArgs, type ParseArgsConfig } from 'node:util'
import type { Command, OptionSpec } from './command'
import type { CliIo } from './io'
import { choiceMessage, CliError, usage } from './errors'
import { applySelfDefaults } from './selectors'
export const globals: Record<string, OptionSpec> = {
  endpoint: {
    type: 'string',
    valueName: 'url',
    description: 'Connect to this Control Surface URL',
  },
  token: { type: 'string', valueName: 'token', description: 'Authenticate with this bearer token' },
  'user-data': { type: 'string', valueName: 'dir', description: 'Use this profile directory' },
  timeout: {
    type: 'number',
    valueName: 'ms',
    description: 'Set the request timeout in milliseconds (default: 20000)',
  },
  pretty: { type: 'boolean', description: 'Indent JSON output for readability' },
  fields: {
    type: 'string',
    valueName: 'a,b,...',
    description:
      'Select item-relative fields; preserve envelopes and accept item-key prefixes. api call queries also accept raw output paths',
  },
  output: {
    type: 'string',
    choices: ['json', 'table'],
    description: 'Choose JSON (default) or a supported table layout',
  },
  help: { type: 'boolean', description: 'Show help for this command or group' },
  version: { type: 'boolean', description: 'Print the CLI version' },
}
export function commandHelpHint(path: string[]) {
  return `Run "opencove${path.length ? ' ' + path.join(' ') : ''} --help" to see its options.`
}
export function suggest(value: string, choices: string[]): string {
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const old = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + Number(a[i - 1] !== b[j - 1]))
        prev = old
      }
    }
    return row[b.length]
  }
  const prefixes = choices.filter(c => c.startsWith(value))
  const best =
    prefixes.length === 1
      ? prefixes[0]
      : [...choices].sort((a, b) => distance(value, a) - distance(value, b))[0]
  return best && (prefixes.length === 1 || distance(value, best) <= 2)
    ? `Did you mean ${best}?`
    : ''
}
export function parse(argv: string[], specs: Record<string, OptionSpec>, path: string[] = []) {
  const options: NonNullable<ParseArgsConfig['options']> = {}
  for (const [key, spec] of Object.entries(specs)) {
    options[key] = {
      type: spec.type === 'boolean' ? 'boolean' : 'string',
      multiple: spec.multiple ?? false,
      ...(key === 'help' ? { short: 'h' } : key === 'output' ? { short: 'o' } : {}),
    }
    if (spec.fileVariant) {
      options[`${key}-file`] = { type: 'string' }
    }
  }
  try {
    const result = parseArgs({
      args: argv,
      options,
      strict: true,
      allowPositionals: true,
      tokens: true,
    })
    const seen = new Set<string>()
    for (const token of result.tokens) {
      if (token.kind !== 'option') {
        continue
      }
      if (seen.has(token.name) && !specs[token.name]?.multiple) {
        usage(`Option --${token.name} may only be specified once.`, commandHelpHint(path))
      }
      seen.add(token.name)
    }
    return result
  } catch (error) {
    if (error instanceof CliError) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    const flag = /(--[\w-]+|-[a-zA-Z])/.exec(message)?.[1] ?? '--option'
    const hint = commandHelpHint(path)
    const context = `"opencove${path.length ? ' ' + path.join(' ') : ''}"`
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      usage(
        `Unknown option ${flag} for ${context}.`,
        [
          suggest(
            flag,
            Object.keys(options).map(k => `--${k}`),
          ),
          hint,
        ]
          .filter(Boolean)
          .join(' '),
      )
    }
    if (message.includes('ambiguous')) {
      usage(
        `Option ${flag} needs an explicit value for ${context}.`,
        `Use ${flag}=-value${options[`${flag.slice(2)}-file`] ? ` or ${flag}-file <path|->` : ''}. ${hint}`,
      )
    }
    usage(`Invalid or missing value for option ${flag} for ${context}.`, hint)
  }
}
// Consume option values as indivisible tokens before identifying the command path.
export function commandWords(argv: string[], specs: Record<string, OptionSpec>): string[] {
  const words: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      words.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith('-')) {
      words.push(arg)
      continue
    }
    const key = arg.slice(2).split('=')[0]
    const spec = specs[key] ?? (arg === '-o' ? globals.output : undefined)
    if (!arg.includes('=') && ((spec && spec.type !== 'boolean') || key.endsWith('-file'))) {
      i++
    }
  }
  return words
}
export async function parseCommand(argv: string[], command: Command, io: CliIo) {
  const specs = { ...globals, ...command.options }
  const parsed = parse(argv, specs, command.path)
  const values: Record<string, unknown> = { ...parsed.values }
  if (!values.help) {
    applySelfDefaults(values, command, io.env)
  }
  for (const [key, spec] of Object.entries(specs)) {
    const file = values[`${key}-file`]
    if (file !== undefined && values.help) {
      delete values[`${key}-file`]
      continue
    }
    if (file !== undefined) {
      if (values[key] !== undefined) {
        if (command.operation === 'agent.prompt' && key === 'text') {
          usage('Use either --text or --text-file, not both.', 'Remove one of the two options.')
        }
        usage(`Cannot use --${key} and --${key}-file together`, commandHelpHint(command.path))
      }
      try {
        // File variants are consumed in order; stdin is a single stream.
        // eslint-disable-next-line no-await-in-loop
        values[key] = file === '-' ? await io.readStdinText() : await io.readTextFile(String(file))
      } catch (error) {
        if (error instanceof CliError && error.exitCode === 130) {
          throw error
        }
        if (command.operation === 'agent.prompt' && key === 'text') {
          usage(
            `Could not read prompt text from ${file}. Nothing was sent.`,
            'Check that the file exists and is readable, or use --text-file - for stdin.',
          )
        }
        usage(`Unable to read --${key}-file: ${file}`)
      }
      delete values[`${key}-file`]
    }
    if (values[key] === undefined) {
      if (spec.required && !values.help) {
        usage(
          `Missing required option --${key} for "opencove ${command.path.join(' ')}".`,
          commandHelpHint(command.path),
        )
      }
      continue
    }
    if (!values.help) {
      for (const other of spec.conflicts ?? []) {
        if (values[other] !== undefined) {
          usage(`Cannot use --${key} and --${other} together`, commandHelpHint(command.path))
        }
      }
    }
    const convert = (value: unknown) => {
      const received = value
      if (spec.type === 'string' && spec.normalize) {
        value = spec.normalize(String(value))
      }
      const choices =
        typeof spec.choices === 'function'
          ? spec.choices({
              options: values,
              positionals: parsed.positionals.slice(command.path.length),
            })
          : spec.choices
      if (choices && !choices.includes(String(value))) {
        usage(choiceMessage(`--${key}`, received, choices), commandHelpHint(command.path))
      }
      if (spec.type === 'number') {
        const duration = key === 'timeout' ? /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(String(value)) : null
        const number = duration
          ? Number(duration[1]) * ({ ms: 1, s: 1000, m: 60000 }[duration[2]] ?? 1)
          : Number(value)
        if (!Number.isFinite(number)) {
          if (command.operation === 'agent.prompt' && key === 'timeout') {
            usage(
              'The delivery timeout must be a whole number of milliseconds from 1ms to 60s.',
              'For example, use --timeout 15s or --timeout 15000ms.',
            )
          }
          usage(`Invalid number for --${key}`)
        }
        return number
      }
      if (spec.type === 'json') {
        try {
          return JSON.parse(String(value))
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          const source = String(value)
          const position = Number(/position (\d+)/.exec(reason)?.[1] ?? jsonErrorOffset(source))
          const before = source.slice(0, position).split('\n')
          const location = /line (\d+) column (\d+)/.exec(reason)
          usage(
            `Invalid JSON for --${key} at line ${location?.[1] ?? before.length}, column ${location?.[2] ?? before.at(-1)!.length + 1}: ${reason.replace(/(?: in JSON)? at position \d+(?: \(line \d+ column \d+\))?$| \(line \d+ column \d+\)$/, '')}`,
            commandHelpHint(command.path),
          )
        }
      }
      return value
    }
    values[key] = Array.isArray(values[key])
      ? (values[key] as unknown[]).map(convert)
      : convert(values[key])
  }
  if (values.timeout !== undefined && Number(values.timeout) <= 0) {
    if (command.operation === 'agent.prompt') {
      usage(
        'The delivery timeout must be a whole number of milliseconds from 1ms to 60s.',
        'For example, use --timeout 15s or --timeout 15000ms.',
      )
    }
    if (command.path.join(' ') === 'agent wait') {
      usage('Wait timeout minimum is 250ms.')
    }
    usage('Timeout must be positive')
  }
  if (
    !values.help &&
    command.targetSpace === 'required' &&
    !['space', 'space-name', 'worker', 'branch', 'path'].some(key => values[key] !== undefined)
  ) {
    usage(
      `Missing required option --space (or another target space option) for "opencove ${command.path.join(' ')}".`,
      commandHelpHint(command.path),
    )
  }
  const positionals = parsed.positionals.slice(command.path.length)
  if (
    !values.help &&
    (positionals.length > (command.positionals?.length ?? 0) ||
      command.positionals?.some((p, i) => p.required && positionals[i] === undefined))
  ) {
    usage(
      `Invalid positional arguments for "opencove ${command.path.join(' ')}".`,
      commandHelpHint(command.path),
    )
  }
  return { options: values, positionals, explicitOptions: new Set(Object.keys(parsed.values)) }
}

export function globalArgv(argv: string[], specs: Record<string, OptionSpec>): string[] {
  const result: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      break
    }
    if (!arg.startsWith('-')) {
      continue
    }
    const key = arg === '-o' ? 'output' : arg === '-h' ? 'help' : arg.slice(2).split('=')[0]
    const spec = specs[key]
    if (globals[key]) {
      result.push(arg)
    }
    if (!arg.includes('=') && ((spec && spec.type !== 'boolean') || key.endsWith('-file'))) {
      i++
      if (globals[key] && argv[i] !== undefined) {
        result.push(argv[i])
      }
    }
  }
  return result
}
