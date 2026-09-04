import type WebSocket from 'ws'
import type { TerminalAgentReexecResult } from '../../../../shared/contracts/dto'
import type { TerminalAgentReexecResultCoordinator } from '../../../../shared/runtime/terminalAgentReexecResultCoordinator'
import { TERMINAL_AGENT_REEXEC_RESULT_TIMEOUT_MS } from '../../../../shared/runtime/terminalAgentReexec'
import type { TerminalAgentReexecRuntimeInput } from '../handlers/sessionPtyRuntime'
import type { RemotePtyEndpointAttachedSessionState } from './remotePtyEndpointProxy.messageHandler'
import { trySendRemotePtyWs } from './remotePtyEndpointProxy.support'

export async function reexecRemotePtyEndpointAgent(options: {
  socket: WebSocket | null
  supported: boolean
  acknowledgements: TerminalAgentReexecResultCoordinator
  attached: RemotePtyEndpointAttachedSessionState | undefined
  input: TerminalAgentReexecRuntimeInput
}): Promise<TerminalAgentReexecResult> {
  const { socket, input } = options
  if (!socket || !options.supported) {
    throw new Error('Remote PTY endpoint does not support terminal Agent re-exec')
  }
  if (
    options.attached?.role !== 'controller' ||
    typeof options.attached.authorityEpoch !== 'number' ||
    !Number.isSafeInteger(options.attached.authorityEpoch)
  ) {
    throw new Error('Remote terminal Agent re-exec requires current controller authority.')
  }
  const pending = options.acknowledgements.waitFor({
    sessionId: input.sessionId,
    operationId: input.operationId,
    timeoutMs: TERMINAL_AGENT_REEXEC_RESULT_TIMEOUT_MS,
  })
  const { authorityEpoch: _upstreamAuthorityEpoch, ...downstreamInput } = input
  void _upstreamAuthorityEpoch
  if (
    !trySendRemotePtyWs(socket, {
      type: 'agent_reexec',
      ...downstreamInput,
      authorityEpoch: options.attached.authorityEpoch,
    })
  ) {
    options.acknowledgements.reject(
      input.sessionId,
      input.operationId,
      new Error('Failed to send remote terminal Agent re-exec request'),
    )
  }
  return await pending
}
