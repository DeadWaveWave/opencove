import { unknownOperation } from './operationErrors'
import { validateUriInputs } from './uriInputs'
import { nodeFieldNotice } from './nodeFields'
import { listLimitNotice, cappedListNotice } from './listOutput'
import { promptValidationPresentation } from '../../../shared/errors/agentPromptError'
import { commands } from '../commands'
import { getControlSurfaceOperation } from '../../../shared/contracts/controlSurface/operations'
import { commandWords, globalArgv, globals, parseCommand, suggest } from './args'
import { CliError, inputErrorMessage, printError, usage, validationError } from './errors'
import { resolveConnection } from './context'
import { invoke } from './transport'
import { get, rawRenderSpec, render, validateRenderOptions } from './render'
import { help } from './help'
import type { CliIo } from './io'
import type { OperationId } from './command'
import { version } from '../../../../package.json'
import { resolveSelectors } from './selectors'
import { requireNodeNearPlacement } from './nodeNearPlacement'
import { requireBoundedAgentSpawningForRequest } from './boundedAgentSpawning'
import { sessionIdentity, selfUnavailable } from './identity'
import type { ZodType } from 'zod'

/**
 * The part of an operation the CLI validates with. Narrowing to this view keeps the call path
 * independent of the registry's full union, which grows past what TypeScript can represent.
 */
type CliOperation =
  // @compat control-surface-legacy-validation
  | { kind: 'query' | 'command'; contract: 'legacy' }
  | {
      kind: 'query' | 'command'
      contract: 'schema'
      input: ZodType
      normalize(wire: never): unknown
      // @compat control-surface-legacy-validation
      legacyNormalize?(payload: unknown): unknown
    }

function commandForOperation(id: string) {
  return commands.find(c => c.operation === id || c.operationAliases?.includes(id as OperationId))
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  let json = false,
    promptCommand = false,
    invokeStarted = false,
    mutationStarted = false
  let scope: { dispose(): void } | undefined
  try {
    const specs = { ...globals, ...Object.assign({}, ...commands.map(c => c.options)) }
    const words = commandWords(argv, specs)
    const command = commands.find(c => c.path.every((part, i) => words[i] === part))
    promptCommand = words[0] === 'agent' && words[1] === 'prompt'
    const globalOptions = await parseCommand(
      globalArgv(argv, specs),
      {
        path: command?.path ?? [],
        summary: '',
        connect: false,
        ...(words[0] === 'agent' && words[1] === 'prompt'
          ? { operation: 'agent.prompt' as const }
          : {}),
      },
      io,
    )
    json = globalOptions.options.output === 'json'
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
    command.validateBeforeConnect?.(args, io.env)
    const execution = command.executionScope?.(args, io)
    if (execution) {
      scope = execution
      io = execution.io
    }
    let input = command.buildInput?.(args)
    const id =
      command.path.join(' ') === 'api call'
        ? args.positionals[0]
        : (command.selectOperation?.(args) ?? command.operation)
    const operation = (id ? getControlSurfaceOperation(id) : undefined) as CliOperation | undefined
    if (id && !operation) {
      unknownOperation(id)
    }
    if (
      command.path.join(' ') === 'api schema' &&
      !getControlSurfaceOperation(args.positionals[0])
    ) {
      unknownOperation(args.positionals[0])
    }
    if (id) {
      validateUriInputs(id, input)
    }
    // The registry describes inputs, not guaranteed result fields. Fail before mutations
    // rather than discover an invalid projection after their effects have completed.
    if (
      ((command.rawQueryFields && operation?.kind === 'command') ||
        (command.stream && !command.streamProjection) ||
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
      command.selectRender?.(args) ??
      (command.rawQueryFields ? rawRenderSpec(commandForOperation(id!)?.render) : command.render)
    validateRenderOptions(args.options, renderSpec)
    if (operation?.contract === 'schema' && !command.serverValidation) {
      try {
        const validation = operation.input.safeParse(input)
        if (!validation.success) {
          // @compat control-surface-legacy-validation
          operation.legacyNormalize?.(input)
          throw validationError(id!, validation.error.issues, 2, 'cli.usage', input)
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
          if (id === 'agent.prompt') {
            const text = promptValidationPresentation(error.details)
            throw new CliError('common.invalid_input', 2, text.message, text.hint, error.details)
          }
          throw validationError(id!, error.details.issues, 2, 'common.invalid_input', input)
        }
        if (
          error &&
          typeof error === 'object' &&
          'issues' in error &&
          Array.isArray(error.issues)
        ) {
          throw validationError(id!, error.issues, 2, 'cli.usage', input)
        }
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'common.invalid_input'
        ) {
          usage(
            inputErrorMessage(
              id!,
              'debugMessage' in error && typeof error.debugMessage === 'string'
                ? error.debugMessage
                : undefined,
            ),
          )
        }
        usage(error instanceof Error ? error.message : String(error))
      }
    }
    for (const [key, spec] of Object.entries(command.options ?? {})) {
      // Batch node failures belong to the command's per-target resolver. Single
      // targets and other selector kinds retain the early identity preflight.
      const deferredBatchNode =
        command.resolveInExecute &&
        spec.selector === 'node' &&
        [args.options[key]].flat().length > 1
      if (
        !deferredBatchNode &&
        spec.selector &&
        [args.options[key]].flat().includes('@self') &&
        io.env.OPENCOVE_ENV !== '1' &&
        !args.options.token &&
        !io.env.OPENCOVE_CONTROL_TOKEN
      ) {
        selfUnavailable(spec.selector)
      }
    }
    const needsConnection =
      command.connect ||
      (['api ops', 'api schema'].includes(command.path.join(' ')) && io.env.OPENCOVE_ENV === '1')
    const connection = needsConnection ? await resolveConnection(args.options, io) : undefined
    // Selector reads and the final query share a per-run snapshot. A write ends
    // that snapshot so a later read cannot reuse data from before its effects.
    const reads = new Map<string, Promise<unknown>>()
    const call = async (
      operationId: OperationId,
      payload: unknown,
      callOptions?: { fresh?: boolean; signal?: AbortSignal; timeoutMs?: number },
    ) => {
      const op = getControlSurfaceOperation(operationId)!
      if (!connection) {
        throw new CliError('context.unreachable', 3, 'No connection')
      }
      await requireNodeNearPlacement(operationId, payload, call)
      await requireBoundedAgentSpawningForRequest(operationId, payload, identity, call)
      const key = JSON.stringify([operationId, payload])
      if (op.kind === 'command') {
        mutationStarted = true
        reads.clear()
      } else if (!callOptions?.fresh && reads.has(key)) {
        return reads.get(key)!
      }
      if (operationId === 'agent.prompt') {
        invokeStarted = true
      }
      const pending = invoke(
        connection,
        { kind: op.kind, id: operationId, payload },
        {
          timeoutMs:
            callOptions?.timeoutMs ??
            (operationId === 'agent.prompt'
              ? Number((payload as { timeoutMs?: number }).timeoutMs ?? 15000) + 5000
              : Number(args.options.timeout ?? command.timeoutMs ?? 20000)),
          fetch: io.fetch,
          signal: callOptions?.signal ?? io.signal,
          errorTargets: command.errorTargets,
          inputOptions: commandForOperation(operationId)?.options,
        },
      )
      if (op.kind === 'query' && !callOptions?.fresh) {
        reads.set(key, pending)
      }
      return pending
    }
    const selfSelected = Object.values(args.options).flat().includes('@self')
    const identity = sessionIdentity(io.env, call)
    if (id) {
      await requireBoundedAgentSpawningForRequest(id, input, identity, call, 'before_selectors')
    }
    if (!command.resolveInExecute) {
      await resolveSelectors(command, args, io, call, identity)
    }
    input = command.buildInput?.(args)
    mutationStarted ||= command.mutation === true
    const result = command.execute
      ? await command.execute({
          ...args,
          io,
          input,
          invoke: call,
          connection,
          selfSelected,
          whoami: identity.whoami,
          self: identity.self,
        })
      : await call(id as OperationId, input)
    if (command.stream) {
      return Number(result)
    }
    // Apply display defaults only after execution: selectors and internal reads stay complete.
    if (args.options.limit === undefined && renderSpec?.defaultLimit && !args.options.full) {
      args.options.limit = renderSpec.defaultLimit
    }
    const output =
      args.options.quiet && command.quietIdPath
        ? String(get(result, command.quietIdPath)) + '\n'
        : command.textOutput && !args.options.output && args.options.fields === undefined
          ? (command.textOutput(result, {
              io,
              options: args.options,
              render: () => render(result, args.options, renderSpec),
            }) ?? render(result, args.options, renderSpec))
          : render(result, args.options, renderSpec)
    const notice = nodeFieldNotice(result, args.options, renderSpec)
    if (notice) {
      io.stderr.write(notice + '\n')
    }
    const tableListKey = args.options.output === 'table' ? renderSpec?.listKey : undefined
    const listNotice =
      renderSpec?.defaultLimit && renderSpec.listKey
        ? cappedListNotice(result, args.options.limit, renderSpec.listKey)
        : listLimitNotice(
            tableListKey ? get(result, tableListKey) : result,
            args.options.limit,
            command.path.join(' ') === 'api ops'
              ? args.options.domains
                ? 'domains'
                : 'operations'
              : (tableListKey ?? 'items'),
          )
    if (listNotice) {
      io.stderr.write(listNotice + '\n')
    }
    io.stdout.write(output)
    if (id === 'agent.delivery.get') {
      const delivery = result as { available?: boolean; status?: string }
      return delivery.available && delivery.status === 'submitted' ? 0 : 1
    }
    return command.exitCode?.(result) ?? 0
  } catch (error) {
    const failure =
      scope && io.signal?.aborted && io.signal.reason instanceof CliError ? io.signal.reason : error
    let cliError =
      failure instanceof CliError
        ? failure
        : new CliError(
            'cli.failed',
            1,
            failure instanceof Error ? failure.message : String(failure),
          )
    if (promptCommand && !invokeStarted && cliError.code === 'cli.interrupted') {
      cliError = new CliError(
        'cli.interrupted',
        130,
        'Interrupted before delivery began. Nothing was sent.',
        'Retry when ready.',
      )
    }
    printError(io, cliError, json, !mutationStarted)
    return cliError.exitCode
  } finally {
    scope?.dispose()
  }
}
