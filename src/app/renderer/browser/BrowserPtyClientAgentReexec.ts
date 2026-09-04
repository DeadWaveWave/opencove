import type { TerminalAgentReexecInput, TerminalAgentReexecResult } from '@shared/contracts/dto'
import { TerminalAgentReexecResultCoordinator } from '@shared/runtime/terminalAgentReexecResultCoordinator'
import {
  normalizeTerminalAgentReexecResult,
  TERMINAL_AGENT_REEXEC_RESULT_TIMEOUT_MS,
} from '@shared/runtime/terminalAgentReexec'

export class BrowserPtyClientAgentReexec {
  private readonly acknowledgements = new TerminalAgentReexecResultCoordinator()
  private supported: boolean | null = null

  public noteHelloAck(record: Record<string, unknown>): void {
    const capabilities =
      record.capabilities &&
      typeof record.capabilities === 'object' &&
      !Array.isArray(record.capabilities)
        ? (record.capabilities as Record<string, unknown>)
        : null
    this.supported = capabilities?.agentReexec === 1
  }

  public handleResult(record: Record<string, unknown>): boolean {
    const result = normalizeTerminalAgentReexecResult(record)
    return result ? this.acknowledgements.resolve(result) : false
  }

  public async reexec(options: {
    input: TerminalAgentReexecInput
    authorityEpoch: number | null
    send: (payload: unknown) => Promise<void>
  }): Promise<TerminalAgentReexecResult> {
    if (this.supported !== true) {
      throw new Error('PTY stream does not support terminal Agent re-exec')
    }
    if (
      typeof options.authorityEpoch !== 'number' ||
      !Number.isSafeInteger(options.authorityEpoch)
    ) {
      throw new Error('Terminal Agent re-exec requires current controller authority.')
    }
    const operationId = options.input.operationId?.trim() || globalThis.crypto.randomUUID()
    const pending = this.acknowledgements.waitFor({
      sessionId: options.input.sessionId,
      operationId,
      timeoutMs: TERMINAL_AGENT_REEXEC_RESULT_TIMEOUT_MS,
    })
    try {
      await options.send({
        type: 'agent_reexec',
        ...options.input,
        operationId,
        ...(typeof options.authorityEpoch === 'number'
          ? { authorityEpoch: options.authorityEpoch }
          : {}),
      })
    } catch (error) {
      this.acknowledgements.reject(
        options.input.sessionId,
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
