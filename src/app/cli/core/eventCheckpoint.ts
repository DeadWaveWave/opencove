import { randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import type { CommandContext } from './command'
import { CliError, usage } from './errors'
import { decodeEventCursor } from '../../../shared/contracts/dto/eventStream'

export async function loadEventCheckpoint(ctx: CommandContext): Promise<void> {
  if (!ctx.options['cursor-file'] || ctx.options.after !== undefined) {
    return
  }
  let cursor: string
  try {
    cursor = (await ctx.io.readTextFile(String(ctx.options['cursor-file']))).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    if (ctx.io.signal?.aborted) {
      throw ctx.io.signal.reason
    }
    throw new CliError('events.checkpoint_failed', 1, 'Unable to read the event cursor file.')
  }
  try {
    decodeEventCursor(cursor)
  } catch {
    usage('Invalid cursor file. Use --after to override it, or remove it to start a fresh stream.')
  }
  ctx.options.after = cursor
}

/** Serial caller; same-directory rename publishes a complete cursor or leaves the old one. */
export async function saveEventCheckpoint(file: unknown, cursor: string): Promise<void> {
  if (file === undefined) {
    return
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, cursor + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, String(file))
  } catch {
    throw new CliError(
      'events.checkpoint_failed',
      1,
      'Unable to save the event cursor file.',
      'The last record was written; resuming the previous checkpoint may replay it.',
      { cursor },
    )
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
