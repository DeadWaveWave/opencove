export interface TerminalSpawnCommand {
  command: string
  args: string[]
}

/** Select display metadata, never the private platform environment transport. */
export function getPublicTerminalSpawnCommand(
  spawn: TerminalSpawnCommand & { publicCommand?: TerminalSpawnCommand },
): TerminalSpawnCommand {
  if (spawn.publicCommand) {
    return { command: spawn.publicCommand.command, args: [...spawn.publicCommand.args] }
  }
  const executable = spawn.command.split(/[\\/]/).at(-1)?.toLowerCase()
  // Older Workers expose WSL's environment transport in argv. Its contents are private.
  const args = executable === 'wsl.exe' || executable === 'wsl' ? [] : [...spawn.args]
  return { command: spawn.command, args }
}
