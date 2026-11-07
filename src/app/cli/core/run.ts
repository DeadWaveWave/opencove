import { commands } from '../commands'
import { getControlSurfaceOperation } from '../../../shared/contracts/controlSurface/operations'
import { commandWords, globalArgv, globals, parseCommand, suggest } from './args'
import { CliError, printError, usage, validationError } from './errors'
import { resolveConnection } from './context'
import { invoke } from './transport'
import { render, validateRenderOptions } from './render'
import { help } from './help'
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
          suggest(words.join(' '), [
            ...new Set(
              commands.flatMap(c => c.path.map((_, i) => c.path.slice(0, i + 1).join(' '))),
            ),
          ]),
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
    let input = command.buildInput?.(args)
    const id =
      command.path.join(' ') === 'api call'
        ? args.positionals[0]
        : (command.selectOperation?.(args) ?? command.operation)
    const operation = id ? getControlSurfaceOperation(id) : undefined
    if (id && !operation) {
      usage(`Unknown operation: ${id}`)
    }
    // The registry describes inputs, not guaranteed result fields. Fail before mutations
    // rather than discover an invalid projection after their effects have completed.
    if (
      ((command.rawQueryFields && operation?.kind === 'command') ||
        command.stream ||
        ((operation?.kind === 'command' || command.mutation) && !command.render?.fields)) &&
      args.options.fields !== undefined
    ) {
      usage(
        '--fields is unavailable for mutation operations',
        command.render?.unavailable ??
          'Generic commands cannot validate output paths before writing. Omit --fields to receive the complete result.',
      )
    }
    const renderSpec =
      command.selectRender?.(args) ?? (command.rawQueryFields ? { rawPaths: true } : command.render)
    validateRenderOptions(args.options, renderSpec)
    if (operation?.contract === 'schema' && !command.serverValidation) {
      try {
        const validation = operation.input.safeParse(input)
        if (!validation.success) {
          operation.legacyNormalize?.(input)
          throw validationError(id!, validation.error.issues)
        }
        const parsed = validation.data
        operation.normalize(parsed as never)
        input = parsed
      } catch (error) {
        if (error instanceof CliError) {
          throw error
        }
        if (
          error &&
          typeof error === 'object' &&
          'details' in error &&
          error.details &&
          typeof error.details === 'object' &&
          'issues' in error.details &&
          Array.isArray(error.details.issues)
        ) {
          throw validationError(id!, error.details.issues, 2, 'common.invalid_input')
        }
        if (
          error &&
          typeof error === 'object' &&
          'issues' in error &&
          Array.isArray(error.issues)
        ) {
          throw validationError(id!, error.issues)
        }
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
        {
          timeoutMs: Number(args.options.timeout ?? command.timeoutMs ?? 20000),
          fetch: io.fetch,
          signal: io.signal,
          errorTargets: command.errorTargets,
        },
      )
    }
    const result = command.execute
      ? await command.execute({ ...args, io, input, invoke: call, connection })
      : await call(id as OperationId, input)
    if (command.stream) {
      return Number(result)
    }
    io.stdout.write(render(result, args.options, renderSpec))
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
