import type {
  TerminalProcessEnginePort,
  TerminalProcessResizeResult,
  TerminalProcessSpawnInput,
} from '../application/ports/TerminalProcessEnginePort'
import type { TerminalForegroundEvent, TerminalWriteEncoding } from '../../../shared/contracts/dto'
import { PtyHostSupervisor } from '../../../platform/process/ptyHost/supervisor'

type PtyHostTerminalProcessEngineOptions = ConstructorParameters<typeof PtyHostSupervisor>[0]

export class PtyHostTerminalProcessEngine implements TerminalProcessEnginePort {
  private readonly supervisor: PtyHostSupervisor
  private readonly dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  private readonly exitListeners = new Set<
    (event: { sessionId: string; exitCode: number }) => void
  >()
  private readonly foregroundListeners = new Set<(event: TerminalForegroundEvent) => void>()
  private readonly disposeSupervisorListeners: readonly (() => void)[]
  private isDisposed = false

  public constructor(options: PtyHostTerminalProcessEngineOptions) {
    this.supervisor = new PtyHostSupervisor(options)
    this.disposeSupervisorListeners = [
      this.supervisor.onData(event => {
        this.dataListeners.forEach(listener => listener(event))
      }),
      this.supervisor.onExit(event => {
        this.exitListeners.forEach(listener => listener(event))
      }),
      this.supervisor.onForeground(event => {
        this.foregroundListeners.forEach(listener => listener(event))
      }),
    ]
  }

  public async spawn(input: TerminalProcessSpawnInput): Promise<{ sessionId: string }> {
    return await this.supervisor.spawn(input)
  }

  public write(sessionId: string, data: string, encoding?: TerminalWriteEncoding): void {
    if (encoding === undefined) {
      this.supervisor.write(sessionId, data)
      return
    }

    this.supervisor.write(sessionId, data, encoding)
  }

  public probeForeground(sessionId: string): void {
    this.supervisor.probeForeground(sessionId)
  }

  public async resize(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<TerminalProcessResizeResult> {
    return await this.supervisor.resize(sessionId, cols, rows)
  }

  public kill(sessionId: string): void {
    this.supervisor.kill(sessionId)
  }

  public onData(listener: (event: { sessionId: string; data: string }) => void): () => void {
    return this.subscribe(this.dataListeners, listener)
  }

  public onExit(listener: (event: { sessionId: string; exitCode: number }) => void): () => void {
    return this.subscribe(this.exitListeners, listener)
  }

  public onForeground(listener: (event: TerminalForegroundEvent) => void): () => void {
    return this.subscribe(this.foregroundListeners, listener)
  }

  public async crashForDebug(): Promise<void> {
    await this.supervisor.crash()
  }

  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true

    this.disposeSupervisorListeners.forEach(dispose => dispose())
    this.dataListeners.clear()
    this.exitListeners.clear()
    this.foregroundListeners.clear()
    this.supervisor.dispose()
  }

  private subscribe<Event>(
    listeners: Set<(event: Event) => void>,
    listener: (event: Event) => void,
  ): () => void {
    if (this.isDisposed) {
      return () => undefined
    }

    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}
