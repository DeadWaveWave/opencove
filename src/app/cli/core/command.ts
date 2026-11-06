import type { CONTROL_SURFACE_OPERATIONS } from '../../../shared/contracts/controlSurface/operations'
import type { CliIo } from './io'
export type OperationId = (typeof CONTROL_SURFACE_OPERATIONS)[number]['id']
export interface OptionSpec {
  type: 'string' | 'boolean' | 'number' | 'json'
  multiple?: boolean
  required?: boolean
  description: string
  valueName?: string
  fileVariant?: true
}
export interface PositionalSpec {
  name: string
  required?: boolean
}
export interface RenderSpec {
  listKey?: string
  columns?: string[]
}
export interface CommandArgs {
  options: Record<string, unknown>
  positionals: string[]
}
export type CommandResult = unknown
export interface CommandContext extends CommandArgs {
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
  connect: boolean
  operation?: OperationId
  buildInput?(args: CommandArgs): unknown
  execute?(ctx: CommandContext): Promise<CommandResult>
  render?: RenderSpec
}
export function defineCommand(command: Command): Command {
  return command
}
