import { legacyCommand } from '../commands/legacy'
import { commands } from '../commands'
import { getControlSurfaceOperation } from '../../../shared/contracts/controlSurface/operations'
import { commandWords, globalArgv, globals, parseCommand, suggest } from './args'
import { CliError, printError, usage } from './errors'
import { resolveConnection } from './context'
import { invoke } from './transport'
import { render, validateRenderOptions } from './render'
import { help, legacyGroups } from './help'
import { legacyHelp } from './helpCatalog'
import type { CliIo } from './io'
import type { OperationId } from './command'
import { version } from '../../../../package.json'
export async function run(argv: string[], io: CliIo): Promise<number> {
  let json = false
  try {
    const specs = { ...globals, ...Object.assign({}, ...commands.map(c => c.options)) }
    const globalOptions = await parseCommand(
      globalArgv(argv, specs),
      { path: [], summary: '', connect: false },
      io,
    )
    json = globalOptions.options.output === 'json'
    const words = commandWords(argv, specs)
    const command = commands.find(c => c.path.every((part, i) => words[i] === part))
    if (
      !command &&
      legacyGroups.includes(words[0]) &&
      words[1] &&
      !legacyHelp[words[0]].some(([syntax]) => syntax.split(' ')[0] === words[1])
    ) {
      usage(
        `Unknown command "${words.join(' ')}" for opencove.`,
        [
          suggest(
            words.slice(0, 2).join(' '),
            legacyHelp[words[0]].map(([syntax]) => `${words[0]} ${syntax.split(' ')[0]}`),
          ),
          `Run "opencove ${words[0]} --help" to see its commands.`,
        ]
          .filter(Boolean)
          .join(' '),
      )
    }
    if (!command && legacyGroups.includes(words[0]) && globalOptions.options.help) {
      io.stdout.write(help(commands, words))
      return 0
    }
    if (!command && legacyGroups.includes(words[0])) {
      return Number(
        await legacyCommand.execute!({
          io,
          positionals: argv,
          options: {},
          input: null,
          invoke: async () => {
            throw new CliError('cli.legacy_boundary', 1, 'Legacy owns transport')
          },
        }),
      )
    }
    if (!command) {
      const parsed = await parseCommand(argv, { path: words, summary: '', connect: false }, io)
      json = parsed.options.output === 'json'
      if (parsed.options.version) {
        io.stdout.write(version + '\n')
        return 0
      }
      if (
        !words.length ||
        (parsed.options.help && commands.some(c => words.every((p, i) => c.path[i] === p)))
      ) {
        io.stdout.write(help(commands, words))
        return parsed.options.help ? 0 : 2
      }
      usage(
        `Unknown command "${words.join(' ')}" for opencove.`,
        [
          suggest(
            words.join(' '),
            commands.map(c => c.path.join(' ')),
          ),
          `Run "opencove${commands.some(c => c.path[0] === words[0]) ? ' ' + words[0] : ''} --help" to see its commands.`,
        ]
          .filter(Boolean)
          .join(' '),
      )
    }
    const args = await parseCommand(argv, command, io)
    json = args.options.output === 'json'
    if (args.options.help) {
      io.stdout.write(help(commands, command.path))
      return 0
    }
    validateRenderOptions(args.options, command.render)
    let input = command.buildInput?.(args)
    const id = command.path.join(' ') === 'api call' ? args.positionals[0] : command.operation
    const operation = id ? getControlSurfaceOperation(id) : undefined
    if (id && !operation) {
      usage(`Unknown operation: ${id}`)
    }
    // The registry describes inputs, not guaranteed result fields. Fail before mutations
    // rather than discover an invalid projection after their effects have completed.
    if (operation?.kind === 'command' && args.options.fields !== undefined) {
      usage(
        '--fields is unavailable for mutation operations',
        'Omit --fields to receive the complete operation result',
      )
    }
    if (operation?.contract === 'schema') {
      try {
        const parsed = operation.input.parse(input)
        operation.normalize(parsed as never)
        input = parsed
      } catch (error) {
        usage(error instanceof Error ? error.message : String(error))
      }
    }
    const connection = command.connect ? await resolveConnection(args.options, io) : undefined
    const call = async (operationId: OperationId, payload: unknown) => {
      const op = getControlSurfaceOperation(operationId)!
      if (!connection) {
        throw new CliError('context.unreachable', 3, 'No connection')
      }
      return invoke(
        connection,
        { kind: op.kind, id: operationId, payload },
        { timeoutMs: Number(args.options.timeout ?? 20000), fetch: io.fetch, signal: io.signal },
      )
    }
    const result = command.execute
      ? await command.execute({ ...args, io, input, invoke: call })
      : await call(id as OperationId, input)
    io.stdout.write(render(result, args.options, command.render))
    return 0
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError('cli.failed', 1, error instanceof Error ? error.message : String(error))
    printError(io, cliError, json)
    return cliError.exitCode
  }
}
