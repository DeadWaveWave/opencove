const distributionCommands = new Set([
  'install-git',
  'source',
  'check',
  'update',
  'apply',
  'rollback',
  'discover',
])
export function parsePluginDistributionCommand(command, values) {
  if (!distributionCommands.has(command)) {
    return undefined
  }
  const options = new Map()
  const count = command === 'discover' ? 0 : command === 'rollback' ? 2 : 1
  const positional = values.slice(0, count)
  const allowed =
    command === 'install-git'
      ? ['--ref', '--directory', '--build', '--script', '--output']
      : ['check', 'update'].includes(command)
        ? ['--ref']
        : command === 'discover'
          ? ['--query']
          : []
  const invalid = () => {
    throw new Error(
      `Invalid plugin ${command} arguments. Run "opencove plugin guide" for distribution instructions.`,
    )
  }
  if (
    positional.length !== count ||
    positional.some(value => !value.trim() || value.startsWith('-'))
  ) {
    invalid()
  }
  for (let index = count; index < values.length; index += 2) {
    if (
      !allowed.includes(values[index]) ||
      options.has(values[index]) ||
      !values[index + 1]?.trim() ||
      values[index + 1].startsWith('-')
    ) {
      invalid()
    }
    options.set(values[index], values[index + 1])
  }
  if (command === 'install-git') {
    const kind = options.get('--build') ?? 'none'
    if (
      !['none', 'npm', 'pnpm'].includes(kind) ||
      (kind === 'none' && (options.has('--script') || options.has('--output')))
    ) {
      invalid()
    }
    return {
      kind: 'command',
      id: 'plugin.git.install',
      payload: {
        repository: positional[0],
        ...(options.has('--ref') ? { ref: options.get('--ref') } : {}),
        directory: options.get('--directory') ?? '.',
        build:
          kind === 'none'
            ? { kind }
            : {
                kind,
                script: options.get('--script') ?? 'build',
                outputDirectory: options.get('--output') ?? '.',
              },
      },
    }
  }
  if (command === 'discover') {
    return {
      kind: 'query',
      id: 'plugin.discover',
      payload: { query: options.get('--query') ?? '' },
    }
  }
  if (command === 'apply') {
    return { kind: 'command', id: 'plugin.git.apply', payload: { candidateId: positional[0] } }
  }
  if (command === 'rollback') {
    return {
      kind: 'command',
      id: 'plugin.rollback',
      payload: { pluginId: positional[0], revision: positional[1] },
    }
  }
  return {
    kind: command === 'source' ? 'query' : 'command',
    id: command === 'source' ? 'plugin.source' : `plugin.git.${command}`,
    payload: {
      pluginId: positional[0],
      ...(options.has('--ref') ? { ref: options.get('--ref') } : {}),
    },
  }
}
