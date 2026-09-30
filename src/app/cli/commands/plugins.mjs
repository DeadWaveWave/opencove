import { parsePluginDistributionCommand } from './pluginDistribution.mjs'
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
  'run',
  'skill',
  'open',
  'windows',
])

export function resolvePluginCommandTimeout(request, requestedTimeout) {
  if (requestedTimeout !== null && requestedTimeout !== undefined) {
    return requestedTimeout
  }
  if (
    request?.id.startsWith('plugin.git.') ||
    request?.id === 'plugin.rollback' ||
    request?.id === 'plugin.reload'
  ) {
    return 600_000
  }
  return ['plugin.install', 'plugin.reload', 'plugin.command.run'].includes(request?.id)
    ? 60_000
    : null
}

function parseContributionCommand(command, values) {
  const count = command === 'run' || command === 'skill' ? 2 : 1
  const positional = values.slice(0, count)
  const flags =
    command === 'run'
      ? ['--params', '--node', '--view', '--project']
      : command === 'open'
        ? ['--node', '--project', '--space']
        : command === 'windows'
          ? ['--project']
          : []
  const options = new Map()
  const invalid = () => {
    throw new Error(
      `usage: opencove plugin ${command} <id>${count === 2 ? (command === 'skill' ? ' <skill>' : ' <command>') : ''}${flags.length ? ` [${flags.join(' | ')} <value>]` : ''}. Run "opencove plugin guide" for instructions.`,
    )
  }
  if (
    positional.length !== count ||
    positional.some(
      (value, index) => !(index === 0 ? /^[a-z][a-z0-9-]*$/ : /^[a-z][a-z0-9.-]*$/).test(value),
    )
  ) {
    invalid()
  }
  for (let index = count; index < values.length; index += 2) {
    const flag = values[index]
    const value = values[index + 1]
    if (
      !flags.includes(flag) ||
      options.has(flag) ||
      !value?.trim() ||
      (value.startsWith('-') && flag !== '--params')
    ) {
      invalid()
    }
    options.set(flag, value)
  }
  const payload = { pluginId: positional[0] }
  if (command === 'open' && options.has('--node') && options.has('--space')) {
    throw new Error(
      'Use --space to place a new window, or --node to open an existing window, not both.',
    )
  }
  if (command === 'skill') {
    return {
      kind: 'query',
      id: 'plugin.skill.get',
      payload: { ...payload, skillId: positional[1] },
    }
  }
  for (const [flag, key] of [
    ['--node', 'nodeId'],
    ['--view', 'viewId'],
    ['--project', 'projectId'],
    ['--space', 'spaceId'],
  ]) {
    if (options.has(flag)) {
      payload[key] = options.get(flag)
    }
  }
  if (command !== 'run') {
    return {
      kind: command === 'windows' ? 'query' : 'command',
      id: command === 'windows' ? 'plugin.window.list' : 'plugin.window.open',
      payload,
    }
  }
  let params = null
  if (options.has('--params')) {
    try {
      params = JSON.parse(options.get('--params'))
    } catch {
      throw new Error('Plugin --params must be valid JSON.')
    }
    if (Buffer.byteLength(JSON.stringify(params)) > 1024 * 1024) {
      throw new Error('Plugin --params exceeds 1 MiB.')
    }
  }
  return {
    kind: 'command',
    id: 'plugin.command.run',
    payload: { ...payload, commandId: positional[1], params },
  }
}

/** Parse before connecting so spelling and argument errors also work offline. */
export function parsePluginCommand(args, cwd = process.cwd()) {
  const [, command, ...values] = args
  const distribution = parsePluginDistributionCommand(command, values)
  if (distribution) {
    return distribution
  }
  if (!COMMANDS.has(command)) {
    throw new Error(
      `unsupported plugin command: ${command || '<missing>'}. Run "opencove plugin guide" for supported plugin development and installation instructions.`,
    )
  }
  if (['run', 'skill', 'open', 'windows'].includes(command)) {
    return parseContributionCommand(command, values)
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
