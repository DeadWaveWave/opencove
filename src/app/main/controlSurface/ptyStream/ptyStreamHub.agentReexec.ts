import { randomUUID } from 'node:crypto'
import type {
  TerminalAgentReexecInput,
  TerminalAgentReexecResult,
  TerminalAgentReexecStatus,
} from '../../../../shared/contracts/dto'
import { normalizeTerminalAgentActivitySnapshot } from '../../../../shared/runtime/terminalAgentActivity'
import { terminalAgentActivityMatchesFence } from '../../../../shared/runtime/terminalAgentReexec'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import { enqueueSessionOperation } from './ptyStreamHub.operationQueue'
import type { ClientState, SessionState } from './ptyStreamState'
import { sendPtyAgentReexecResult } from './ptyStreamWire'

export type PtyStreamHubAgentReexecOptions = TerminalAgentReexecInput & { clientId: string }

function createResult(
  input: PtyStreamHubAgentReexecOptions,
  operationId: string,
  status: TerminalAgentReexecStatus,
): TerminalAgentReexecResult {
  return { sessionId: input.sessionId, operationId, status }
}

export async function reexecPtyStreamAgent(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  ptyRuntime: ControlSurfacePtyRuntime
  input: PtyStreamHubAgentReexecOptions
}): Promise<TerminalAgentReexecResult> {
  const operationId = options.input.operationId?.trim() || randomUUID()
  const initialSession = options.sessions.get(options.input.sessionId) ?? null
  const initialClient = options.clients.get(options.input.clientId) ?? null
  if (!initialSession || !initialClient) {
    const result = createResult(options.input, operationId, 'session_not_found')
    if (initialClient) {
      sendPtyAgentReexecResult(initialClient.ws, result)
    }
    return result
  }

  return await enqueueSessionOperation(initialSession, async () => {
    const session = options.sessions.get(options.input.sessionId) ?? null
    const client = options.clients.get(options.input.clientId) ?? null
    const finish = (status: TerminalAgentReexecStatus): TerminalAgentReexecResult => {
      const result = createResult(options.input, operationId, status)
      if (client) {
        sendPtyAgentReexecResult(client.ws, result)
      }
      return result
    }
    if (!session || session !== initialSession || !client || client !== initialClient) {
      return finish('session_not_found')
    }
    if (!session.subscribers.has(options.input.clientId)) {
      return finish('rejected_not_controller')
    }
    if (session.controllerClientId !== options.input.clientId) {
      return finish('rejected_not_controller')
    }
    if (
      typeof options.input.authorityEpoch !== 'number' ||
      !Number.isSafeInteger(options.input.authorityEpoch) ||
      options.input.authorityEpoch !== session.authorityEpoch
    ) {
      return finish('rejected_stale_authority')
    }
    if (session.status !== 'running') {
      return finish('session_not_found')
    }

    const rawActivity = session.agentMetadata?.terminalAgentActivity
    const currentActivity = normalizeTerminalAgentActivitySnapshot(rawActivity)
    const currentProvider =
      currentActivity?.provider ?? session.agentMetadata?.agentProvider ?? null
    if (
      currentProvider !== options.input.provider ||
      (rawActivity && !currentActivity) ||
      !terminalAgentActivityMatchesFence(currentActivity, options.input.expectedActivity)
    ) {
      return finish('rejected_stale_activity')
    }
    if (!options.ptyRuntime.reexecAgent) {
      return finish('runtime_failed')
    }

    try {
      const { clientId: _clientId, ...runtimeInput } = options.input
      void _clientId
      const result = await options.ptyRuntime.reexecAgent({
        ...runtimeInput,
        operationId,
      })
      return finish(result.status)
    } catch {
      return finish('runtime_failed')
    }
  })
}
