import { EventEmitter } from 'node:events'
import type { PtyHostProcess } from '@platform/process/ptyHost/supervisor'

export class TestPtyHostProcess extends EventEmitter implements PtyHostProcess {
  public readonly sentMessages: unknown[] = []
  public readonly failPostMessageTypes = new Set<string>()
  public readonly stdout = null
  public readonly stderr = null
  public pid: number | undefined = 1234
  public killCalls = 0
  public readonly killSignals: Array<'SIGTERM' | 'SIGKILL' | undefined> = []
  public exitOnKill = true

  public postMessage(message: unknown, callback?: (error: Error | null) => void): void {
    const record =
      message && typeof message === 'object' ? (message as Record<string, unknown>) : null
    const messageType = typeof record?.type === 'string' ? record.type : null

    if (messageType && this.failPostMessageTypes.has(messageType)) {
      callback?.(new Error('Channel closed'))
      return
    }

    this.sentMessages.push(message)
    callback?.(null)
  }

  public kill(signal?: 'SIGTERM' | 'SIGKILL'): boolean {
    this.killCalls += 1
    this.killSignals.push(signal)
    if (this.exitOnKill) {
      this.emit('exit', 0)
    }
    return true
  }
}

export function findLastSentMessage<T extends { type: string }>(
  process: TestPtyHostProcess,
  type: T['type'],
): T | null {
  for (let index = process.sentMessages.length - 1; index >= 0; index -= 1) {
    const message = process.sentMessages[index]
    if (!message || typeof message !== 'object') {
      continue
    }
    if ((message as Record<string, unknown>).type === type) {
      return message as T
    }
  }
  return null
}
