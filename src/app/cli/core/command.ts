import type { CONTROL_SURFACE_OPERATIONS } from '../../../shared/contracts/controlSurface/operations'
import type { Connection } from './context'
import type { CliIo } from './io'
export type OperationId = (typeof CONTROL_SURFACE_OPERATIONS)[number]['id']
export interface OptionSpec {
  type: 'string' | 'boolean' | 'number' | 'json'
  multiple?: boolean
  required?: boolean
  description: string
  valueName?: string
  conflicts?: string[]
  fileVariant?: true
}
export interface PositionalSpec {
  name: string
  required?: boolean
}
export interface RenderSpec {
  fields?: string[]
  defaultFields?: string[]
  list?: boolean
  /** The same declared item can be returned at the root or inside itemKey. */
  itemAtRoot?: boolean
  unavailable?: string
  itemKey?: string
  rawPaths?: boolean
  examples?: string[]
  tableFields?: Record<string, string[]>
  listKey?: string
  envelopeFields?: Record<string, string>
  columns?: string[]
}
export interface CommandArgs {
  options: Record<string, unknown>
  positionals: string[]
}
export type CommandResult = unknown
export interface CommandContext extends CommandArgs {
  connection?: Connection
  io: CliIo
  input: unknown
  invoke(id: OperationId, payload: unknown): Promise<unknown>
}
export interface Command {
  path: string[]
  summary: string
  description?: string
  examples?: string[]
  options?: Record<string, OptionSpec>
  positionals?: PositionalSpec[]
  targetSpace?: 'required' | 'optional'
  mutation?: boolean
  stream?: boolean
  timeoutMs?: number
  connect: boolean
  selectOperation?(args: CommandArgs): OperationId
  operationAliases?: OperationId[]
  operationCommand?: string
  operation?: OperationId
  buildInput?(args: CommandArgs): unknown
  execute?(ctx: CommandContext): Promise<CommandResult>
  errorTargets?: ErrorTarget[]
  rawQueryFields?: boolean
  serverValidation?: boolean
  selectRender?(args: CommandArgs): RenderSpec
  render?: RenderSpec
}
export function defineCommand(command: Command): Command {
  return command
}

export interface ErrorTarget {
  entity?: string
  codes: string[]
  fields: Record<string, string>
  listCommand: string
}
