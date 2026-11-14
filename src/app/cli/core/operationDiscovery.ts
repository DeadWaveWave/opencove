import { CliError } from './errors'
import type { CommandContext, OperationId } from './command'

/** Discover before invoking a mutation that an older Worker may deny as unknown. */
export async function requireWorkerOperation(
  invoke: CommandContext['invoke'],
  id: OperationId,
): Promise<void> {
  let result: { operations?: { id: string }[] }
  try {
    result = (await invoke('system.operations', {})) as typeof result
  } catch (error) {
    if (!(error instanceof CliError) || error.exitCode !== 5) {
      throw error
    }
    throw unsupported(id)
  }
  if (!result.operations?.some(op => op.id === id)) {
    throw unsupported(id)
  }
}
function unsupported(id: string): CliError {
  return new CliError(
    'cli.unsupported',
    5,
    `The connected OpenCove Worker does not support ${id}.`,
    'Restart or update OpenCove, then retry.',
  )
}
