import { defineCommand } from '../core/command'
import { CliError } from '../core/errors'

// The legacy dispatcher owns parsing, lifecycle and output until PR-5b.
export const legacyCommand = defineCommand({
  path: ['legacy'],
  summary: 'Dispatch commands awaiting migration',
  connect: false,
  async execute({ io, positionals }) {
    if (!io.legacy) {
      throw new CliError('cli.legacy_unavailable', 1, 'Legacy adapter unavailable')
    }
    return io.legacy(positionals)
  },
})
