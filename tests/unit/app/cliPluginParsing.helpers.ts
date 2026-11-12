import { parse, globals } from '../../../src/app/cli/core/args'
import { pluginCommands } from '../../../src/app/cli/commands/plugins'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
export { resolvePluginCommandTimeout } from '../../../src/app/cli/commands/plugins'
// Pure input mapping adapter for the existing domain contract fixtures.
export function parsePluginCommand(argv: string[]) {
  const command = pluginCommands.find(c => c.path[1] === argv[1])
  if (!command) {
    throw Error('Unknown command')
  }
  const specs = { ...globals, ...command.options }
  const result = parse(argv, specs)
  const options: Record<string, unknown> = { ...result.values }
  const positionals = result.positionals.slice(2)
  if (positionals.length !== (command.positionals?.length ?? 0)) {
    throw Error('Invalid positionals')
  }
  for (const [key, spec] of Object.entries(specs)) {
    const choices =
      typeof spec.choices === 'function' ? spec.choices({ options, positionals }) : spec.choices
    if (options[key] !== undefined && choices && !choices.includes(String(options[key]))) {
      throw Error(`Invalid --${key}`)
    }
    if (spec.type === 'json' && options[key] !== undefined) {
      options[key] = JSON.parse(String(options[key]))
    }
  }
  return {
    kind: getControlSurfaceOperation(command.operation!)!.kind,
    id: command.operation!,
    payload: command.buildInput!({ options, positionals }),
  }
}
