import type { Command, CommandArgs } from './command'
import type { CliIo } from './io'
import type { Invoke } from './identity'
import type { GetNodeResult } from '../../../shared/contracts/dto/nodeControl'
import { CliError } from './errors'

const spaceLocatorKeys = ['space', 'space-name', 'worker', 'branch', 'path']

/** Resolve only implicit node create/list targets; explicit @self keeps its identity semantics. */
export async function resolveCurrentContainer(
  command: Command,
  args: CommandArgs,
  io: CliIo,
  invoke: Invoke,
  self: (kind: 'node') => Promise<string>,
) {
  if (
    !command.currentContainer ||
    args.options['spawned-by'] !== undefined ||
    io.env.OPENCOVE_ENV !== '1' ||
    args.options['root-canvas'] ||
    ['project', ...spaceLocatorKeys].some(key => args.explicitOptions?.has(key))
  ) {
    return
  }
  const nodeId = await self('node')
  const { node } = (await invoke('node.get', { nodeId })) as GetNodeResult
  if (!node || node.id !== nodeId) {
    throw new CliError('node.not_found', 1, 'Your OpenCove terminal node could not be found.')
  }
  args.options.project = node.projectId
  if (node.spaceId === null) {
    delete args.options.space
  } else {
    args.options.space = node.spaceId
  }
  return true
}
