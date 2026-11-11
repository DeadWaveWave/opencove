import { resolveConnection, type Connection } from '../../src/app/cli/core/context'
import { CliError } from '../../src/app/cli/core/errors'
import { createNodeCliIo } from '../../src/app/cli/core/io'

/** Wait for this profile's live discovery file, using the CLI's validation and ambiguity rules. */
export async function waitForControlSurfaceConnection(
  userDataDir: string,
  timeoutMs = 10_000,
): Promise<Connection> {
  const io = createNodeCliIo()
  const deadline = Date.now() + timeoutMs
  const attempt = async (): Promise<Connection> => {
    try {
      // Parent-shell credentials must never redirect an isolated E2E to another profile.
      return await resolveConnection({ 'user-data': userDataDir }, { ...io, env: {} })
    } catch (error) {
      if (
        !(error instanceof CliError) ||
        error.code !== 'context.unreachable' ||
        Date.now() >= deadline
      ) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())))
      return await attempt()
    }
  }
  try {
    return await attempt()
  } finally {
    io.dispose?.()
  }
}
