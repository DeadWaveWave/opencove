import { randomUUID } from 'node:crypto'
import type {
  TerminalAgentReexecInput,
  TerminalAgentReexecResult,
  TerminalGeometryAuthority,
} from '../../../../shared/contracts/dto'
import { TerminalAgentReexecResultCoordinator } from '../../../../shared/runtime/terminalAgentReexecResultCoordinator'
import { TERMINAL_AGENT_REEXEC_RESULT_TIMEOUT_MS } from '../../../../shared/runtime/terminalAgentReexec'

export class RemotePtyRuntimeAgentReexecCoordinator {
  private readonly acknowledgements = new TerminalAgentReexecResultCoordinator()
  private supported: boolean | null = null

  public noteCapability(supported: boolean): void {
    this.supported = supported
  }

  public handleResult(result: TerminalAgentReexecResult): void {
    this.acknowledgements.resolve(result)
  }

  public async reexec(
    input: TerminalAgentReexecInput,
    attached:
      | { role: TerminalGeometryAuthority['role']; authorityEpoch: number | null }
      | undefined,
    timeoutMs: number,
    send: (payload: unknown) => Promise<void>,
  ): Promise<TerminalAgentReexecResult> {
    if (this.supported !== true) {
      throw new Error('PTY stream does not support terminal Agent re-exec')
    }
    if (
      attached?.role !== 'controller' ||
      typeof attached.authorityEpoch !== 'number' ||
      !Number.isSafeInteger(attached.authorityEpoch)
    ) {
      throw new Error('Remote terminal Agent re-exec requires current controller authority.')
    }
    const operationId = input.operationId?.trim() || randomUUID()
    const pending = this.acknowledgements.waitFor({
      sessionId: input.sessionId,
      operationId,
      timeoutMs: Math.max(timeoutMs, TERMINAL_AGENT_REEXEC_RESULT_TIMEOUT_MS),
    })
    try {
      await send({
        type: 'agent_reexec',
        ...input,
        operationId,
        authorityEpoch: attached.authorityEpoch,
      })
    } catch (error) {
      this.acknowledgements.reject(
        input.sessionId,
        operationId,
        error instanceof Error ? error : new Error(String(error)),
      )
    }
    return await pending
  }

  public rejectSession(sessionId: string, error: Error): void {
    this.acknowledgements.rejectSession(sessionId, error)
  }

  public rejectAll(error: Error): void {
    this.supported = null
    this.acknowledgements.rejectAll(error)
  }
}
