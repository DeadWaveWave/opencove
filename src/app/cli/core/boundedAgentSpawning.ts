import type { Invoke, sessionIdentity } from './identity'
import type { ControlSurfaceCapabilitiesResult } from '../../../shared/contracts/dto'
import { CliError } from './errors'
import { agentSpawnPresentations } from '../../../shared/errors/agentSpawnError'
const runtimeOperations = new Set([
  'session.launchAgent',
  'session.launchAgentInMount',
  'session.spawnTerminal',
  'pty.spawn',
  'pty.spawnInMount',
])
/** The shared dispatcher covers dedicated commands and api call, without trusting env hints. */
export async function requireBoundedAgentSpawningForRequest(
  id: string,
  payload: unknown,
  identity: ReturnType<typeof sessionIdentity>,
  invoke: Invoke,
): Promise<void> {
  const kind = (payload as { kind?: string } | null)?.kind
  if (
    !runtimeOperations.has(id) &&
    !(id === 'node.create' && (kind === 'agent' || kind === 'terminal'))
  ) {
    return
  }
  const caller = await identity.whoami()
  if (!['session-grant', 'bearer', 'cookie'].includes(caller.caller)) {
    throw new CliError(
      'transport.invalid_response',
      1,
      'The Worker did not return a valid caller identity.',
    )
  }
  if (caller.caller !== 'session-grant') {
    return
  }
  const result = (await invoke('system.capabilities', {})) as ControlSurfaceCapabilitiesResult
  if (result.features?.boundedAgentSpawningV1 === true) {
    return
  }
  const text = agentSpawnPresentations.agentSpawnCapability
  throw new CliError('cli.unsupported', 5, text.message, text.hint)
}
