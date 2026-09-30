import { resolve } from 'node:path'

const COMMANDS = new Set([
  'guide',
  'list',
  'install',
  'reload',
  'uninstall',
  'enable',
  'disable',
  'details',
])

export function resolvePluginCommandTimeout(request, requestedTimeout) {
  if (requestedTimeout !== null && requestedTimeout !== undefined) {
    return requestedTimeout
  }
  return request?.id === 'plugin.install' || request?.id === 'plugin.reload' ? 60_000 : null
}

/** Parse before connecting so spelling and argument errors also work offline. */
export function parsePluginCommand(args, cwd = process.cwd()) {
  const [, command, ...values] = args
  if (!COMMANDS.has(command)) {
    throw new Error(
      `unsupported plugin command: ${command || '<missing>'}. Run "opencove plugin guide" for supported plugin development and installation instructions.`,
    )
  }

  const takesValue = command !== 'guide' && command !== 'list'
  if (
    values.length !== (takesValue ? 1 : 0) ||
    values.some(value => value.startsWith('-') || !value.trim())
  ) {
    const argument = command === 'install' ? ' <directory>' : takesValue ? ' <id>' : ''
    throw new Error(
      `usage: opencove plugin ${command}${argument}. Run "opencove plugin guide" for instructions.`,
    )
  }
  if (command === 'guide') {
    return null
  }
  if (command === 'list') {
    return { kind: 'query', id: 'plugin.list', payload: null }
  }
  if (command === 'install') {
    return {
      kind: 'command',
      id: 'plugin.install',
      payload: { directory: resolve(cwd, values[0]) },
    }
  }
  if (command === 'enable' || command === 'disable') {
    return {
      kind: 'command',
      id: 'plugin.setEnabled',
      payload: { pluginId: values[0], enabled: command === 'enable' },
    }
  }
  return {
    kind: command === 'details' ? 'query' : 'command',
    id: `plugin.${command}`,
    payload: { pluginId: values[0] },
  }
}
