import type {
  PluginHostAuthority,
  PluginOperationSnapshot,
  PluginResolvedTarget,
} from '../domain/pluginHostTypes'

export interface PluginOperationPort {
  spawn(
    target: PluginResolvedTarget,
    command: string,
    args: string[],
    assertActive: () => void,
  ): Promise<string>
  snapshot(sessionId: string): {
    output: string
    truncated: boolean
    exitCode: number | null
    exited: boolean
  }
  kill(sessionId: string): void
  forget(sessionId: string): void
}
interface Operation {
  ownerId: string
  authority: PluginHostAuthority
  value: PluginOperationSnapshot
  sessionId: string | null
  timer: ReturnType<typeof setInterval> | null
  deadline: number
  cancelDeadline: number | null
  retired: boolean
}
const OUTPUT_BYTES = 256 * 1024
const terminal = (value: PluginOperationSnapshot) =>
  ['completed', 'cancelled', 'failed'].includes(value.status)

/** Sole owner of transient target jobs. Never persists a command or replays it after reconnect. */
export class PluginTargetOperations {
  private readonly operations = new Map<string, Operation>()
  constructor(
    private readonly port: PluginOperationPort,
    private readonly createId: () => string,
  ) {}

  start(
    authority: PluginHostAuthority,
    target: PluginResolvedTarget,
    command: string,
    args: string[],
    timeoutMs: number,
  ) {
    authority.assertActive()
    const owned = [...this.operations.values()].filter(item => item.ownerId === authority.ownerId)
    if (owned.filter(item => !terminal(item.value)).length >= 4) {
      throw new Error('Too many running plugin operations.')
    }
    if (owned.length >= 64) {
      const oldest = owned.find(item => terminal(item.value))
      if (oldest) {
        this.operations.delete(oldest.value.operationId)
      }
    }
    if (this.operations.size >= 256) {
      const oldest = [...this.operations.values()].find(item => terminal(item.value))
      if (oldest) {
        this.operations.delete(oldest.value.operationId)
      } else {
        throw new Error('Plugin operation capacity reached; wait for running operations to finish.')
      }
    }
    const operation: Operation = {
      ownerId: authority.ownerId,
      authority,
      sessionId: null,
      timer: null,
      deadline: Date.now() + timeoutMs,
      cancelDeadline: null,
      retired: false,
      value: {
        operationId: this.createId(),
        status: 'starting',
        target,
        output: '',
        truncated: false,
        exitCode: null,
        error: null,
      },
    }
    this.operations.set(operation.value.operationId, operation)
    operation.timer = setInterval(() => this.tick(operation), 100)
    operation.timer.unref?.()
    void this.spawn(operation, command, args)
    return structuredClone(operation.value)
  }

  private async spawn(operation: Operation, command: string, args: string[]): Promise<void> {
    try {
      operation.authority.assertActive()
      const sessionId = await this.port.spawn(operation.value.target, command, args, () => {
        operation.authority.assertActive()
        if (operation.retired || operation.value.status !== 'starting') {
          throw new Error('Operation was cancelled before dispatch.')
        }
      })
      operation.sessionId = sessionId
      if (
        operation.retired ||
        operation.value.status === 'cancelling' ||
        terminal(operation.value)
      ) {
        this.port.kill(sessionId)
        if (terminal(operation.value)) {
          this.port.forget(sessionId)
        }
      } else {
        try {
          operation.authority.assertActive()
        } catch {
          this.requestCancel(operation)
        }
        if (operation.value.status === 'starting') {
          operation.value.status = 'running'
        }
      }
      this.tick(operation)
    } catch (error) {
      operation.value.error = error instanceof Error ? error.message : String(error)
      this.finish(operation, operation.value.status === 'cancelling' ? 'cancelled' : 'failed')
    }
  }

  private finish(operation: Operation, status: PluginOperationSnapshot['status']): void {
    operation.value.status = status
    if (operation.timer) {
      clearInterval(operation.timer)
    }
    operation.timer = null
    if (operation.sessionId) {
      this.port.forget(operation.sessionId)
    }
    if (operation.retired) {
      this.operations.delete(operation.value.operationId)
    }
  }

  private tick(operation: Operation): void {
    if (terminal(operation.value)) {
      return
    }
    try {
      if (operation.sessionId) {
        const snapshot = this.port.snapshot(operation.sessionId)
        const bytes = new TextEncoder().encode(snapshot.output)
        let offset = Math.max(0, bytes.byteLength - OUTPUT_BYTES)
        // Keep the retained tail aligned to UTF-8, so replacement characters cannot exceed the cap.
        while (offset < bytes.byteLength && (bytes[offset]! & 0xc0) === 0x80) {
          offset++
        }
        operation.value.output = offset
          ? new TextDecoder().decode(bytes.subarray(offset))
          : snapshot.output
        operation.value.truncated = snapshot.truncated || bytes.byteLength > OUTPUT_BYTES
        if (snapshot.exited) {
          operation.value.exitCode = snapshot.exitCode
          this.finish(
            operation,
            operation.value.status === 'cancelling' ? 'cancelled' : 'completed',
          )
          return
        }
      }
      if (operation.cancelDeadline !== null && Date.now() >= operation.cancelDeadline) {
        operation.value.error =
          'Cancellation was requested, but the target did not confirm process exit.'
        this.finish(operation, 'failed')
      } else if (Date.now() >= operation.deadline && operation.value.status !== 'cancelling') {
        operation.value.error = 'Operation timed out; cancellation requested.'
        this.requestCancel(operation)
      }
    } catch (error) {
      operation.value.error = error instanceof Error ? error.message : String(error)
      try {
        if (operation.sessionId) {
          this.port.kill(operation.sessionId)
        }
      } catch {
        /* Preserve the original failure. */
      }
      this.finish(operation, 'failed')
    }
  }

  private requestCancel(operation: Operation): void {
    if (terminal(operation.value) || operation.value.status === 'cancelling') {
      return
    }
    operation.value.status = 'cancelling'
    operation.cancelDeadline = Date.now() + 5000
    if (operation.sessionId) {
      this.port.kill(operation.sessionId)
    }
  }

  private owned(ownerId: string, operationId: string): Operation {
    const operation = this.operations.get(operationId)
    if (!operation || operation.ownerId !== ownerId) {
      throw new Error('Plugin operation is unavailable in this host context.')
    }
    return operation
  }

  get(ownerId: string, operationId: string): PluginOperationSnapshot {
    const operation = this.owned(ownerId, operationId)
    this.tick(operation)
    return structuredClone(operation.value)
  }

  cancel(ownerId: string, operationId: string): PluginOperationSnapshot {
    const operation = this.owned(ownerId, operationId)
    this.requestCancel(operation)
    return this.get(ownerId, operationId)
  }

  async retire(ownerId: string): Promise<void> {
    for (const operation of this.operations.values()) {
      if (operation.ownerId !== ownerId) {
        continue
      }
      operation.retired = true
      if (terminal(operation.value)) {
        this.operations.delete(operation.value.operationId)
      } else {
        try {
          this.requestCancel(operation)
        } catch {
          this.finish(operation, 'failed')
        }
      }
    }
  }
}
