export function resolveCommand(command, options = {}) {
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath

  if (command === 'node') {
    return execPath
  }
  if (command === 'pnpm') {
    return platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  }
  return command
}

export function shouldUseShell(command, options = {}) {
  const platform = options.platform ?? process.platform
  return platform === 'win32' && /\.(?:bat|cmd)$/i.test(command)
}

export function resolveSpawnInvocation(command, options = {}) {
  const resolvedCommand = resolveCommand(command, options)
  return {
    command: resolvedCommand,
    shell: shouldUseShell(resolvedCommand, options),
  }
}
