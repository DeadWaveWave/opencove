import type { CONTROL_SURFACE_OPERATIONS } from '../../../shared/contracts/controlSurface/operations'
import type { Connection } from './context'
import type { CliIo } from './io'
import type { CallerIdentity } from './identity'
export type OperationId = (typeof CONTROL_SURFACE_OPERATIONS)[number]['id']
export interface OptionSpec {
  selector?: 'node' | 'space' | 'project'
  defaultSelf?: boolean
  defaultSelfUnless?: string[]
  short?: string
  type: 'string' | 'boolean' | 'number' | 'json'
  multiple?: boolean
  required?: boolean
  description: string
  valueName?: string
  choices?: readonly string[] | ((args: CommandArgs) => readonly string[])
  /** Wire payload path for enriching server errors from the same choice declaration. */
  inputPath?: string
  normalize?: (value: string) => string
  conflicts?: string[]
  fileVariant?: true
}
export interface PositionalSpec {
  name: string
  required?: boolean
}
export interface RenderSpec {
  /** Presentation-only cap for the declared list; never sent to the Worker. */
  defaultLimit?: number
  fields?: string[]
  defaultFields?: string[]
  list?: boolean
  /** The same declared item can be returned at the root or inside itemKey. */
  itemAtRoot?: boolean
  unavailable?: string
  itemKey?: string
  /** Declared envelope fields to project alongside the item while retaining other metadata. */
  projectedEnvelopeFields?: string[]
  rawPaths?: boolean
  aliases?: Record<string, string>
  declaredRawPaths?: string[]
  rawItemKey?: string
  fieldHints?: Record<string, string>
  /** Help text for declared projectable fields; never changes output validation. */
  fieldDescriptions?: Record<string, string>
  examples?: string[]
  tableFields?: Record<string, string[]>
  listKey?: string
  envelopeFields?: Record<string, string>
  columns?: string[]
}
export interface CommandArgs {
  options: Record<string, unknown>
  positionals: string[]
  explicitOptions?: ReadonlySet<string>
}
export type CommandResult = unknown
export interface CommandContext extends CommandArgs {
  selfSelected?: boolean
  connection?: Connection
  io: CliIo
  input: unknown
  invoke(
    id: OperationId,
    payload: unknown,
    options?: { fresh?: boolean; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown>
  whoami(): Promise<CallerIdentity>
  self(kind: NonNullable<OptionSpec['selector']>): Promise<string>
}
export interface Command {
  /** Explicit usage for cross-option constraints enforced by the command. */
  usage?: string
  path: string[]
  summary: string
  description?: string
  examples?: string[]
  options?: Record<string, OptionSpec>
  positionals?: PositionalSpec[]
  /** Use the caller node's current container for implicit node create/list targets. */
  currentContainer?: boolean
  targetSpace?: 'required' | 'optional'
  /** Stable identifier to print for --quiet, relative to the operation result. */
  quietIdPath?: string
  mutation?: boolean
  stream?: boolean
  streamProjection?: boolean
  /** The command resolves its own selectors (e.g. per target, or after decoding a cursor). */
  resolveInExecute?: boolean
  executionScope?(args: CommandArgs, io: CliIo): { io: CliIo; dispose(): void }
  timeoutMs?: number
  connect: boolean
  selectOperation?(args: CommandArgs): OperationId
  operationAliases?: OperationId[]
  operationCommand?: string
  operation?: OperationId
  validateBeforeConnect?(args: CommandArgs, env: CliIo['env']): void
  buildInput?(args: CommandArgs): unknown
  exitCode?(result: unknown): number
  textOutput?(result: unknown): string | undefined
  execute?(ctx: CommandContext): Promise<CommandResult>
  errorTargets?: ErrorTarget[]
  rawQueryFields?: boolean
  serverValidation?: boolean
  selectRender?(args: CommandArgs): RenderSpec
  render?: RenderSpec
}
export function defineCommand(command: Command): Command {
  const options = { ...command.options }
  if (command.quietIdPath) {
    options.quiet = {
      type: 'boolean',
      short: 'q',
      conflicts: ['fields', 'output'],
      description: 'Print only the created object identifier followed by a newline',
    }
  }
  if (command.render?.defaultLimit) {
    options.full = { type: 'boolean', description: 'Show all results unless --limit is specified' }
  }
  if (options.node && !options.space) {
    options.space = {
      type: 'string',
      valueName: 'selector',
      description: 'Require every node selector, including full IDs, to belong to this space',
      defaultSelf: false,
    }
  }
  // Selector semantics and help share this metadata, including plugin targets.
  for (const kind of ['node', 'space', 'project'] as const) {
    if (options[kind]) {
      options[kind] = {
        ...options[kind],
        selector: kind,
        defaultSelf: options[kind].defaultSelf ?? kind !== 'node',
      }
    }
  }
  if ((options.node || options.space) && !options.project) {
    options.project = {
      type: 'string',
      valueName: 'id',
      description: 'Narrow target lookup to a project',
      selector: 'project',
    }
  }
  command.options = options
  return command
}

export interface ErrorTarget {
  entity?: string
  codes: string[]
  fields: Record<string, string>
  listCommand: string
}
