import { vi } from 'vitest'
import type {
  TerminalProcessEnginePort,
  TerminalProcessResizeResult,
  TerminalProcessSpawnInput,
} from '../../src/contexts/terminal/application/ports/TerminalProcessEnginePort'
import type { TerminalForegroundEvent, TerminalWriteEncoding } from '../../src/shared/contracts/dto'

type DataEvent = { sessionId: string; data: string }
type ExitEvent = { sessionId: string; exitCode: number }

export class FakeTerminalProcessEngine implements TerminalProcessEnginePort {
  private readonly dataListeners = new Set<(event: DataEvent) => void>()
  private readonly exitListeners = new Set<(event: ExitEvent) => void>()
  private readonly foregroundListeners = new Set<(event: TerminalForegroundEvent) => void>()

  public readonly spawn = vi.fn(
    async (_input: TerminalProcessSpawnInput): Promise<{ sessionId: string }> => ({
      sessionId: 'session-1',
    }),
  )
  public readonly write = vi.fn(
    (_sessionId: string, _data: string, _encoding?: TerminalWriteEncoding): void => undefined,
  )
  public readonly probeForeground = vi.fn((_sessionId: string): void => undefined)
  public readonly resize = vi.fn(
    async (
      sessionId: string,
      cols: number,
      rows: number,
    ): Promise<TerminalProcessResizeResult> => ({
      sessionId,
      status: 'applied_verified',
      cols,
      rows,
    }),
  )
  public readonly kill = vi.fn((_sessionId: string): void => undefined)
  public readonly crashForDebug = vi.fn((): void => undefined)
  public readonly dispose = vi.fn((): void => undefined)
  public readonly disposedSubscriptions = {
    data: vi.fn(),
    exit: vi.fn(),
    foreground: vi.fn(),
  }

  public onData(listener: (event: DataEvent) => void): () => void {
    this.dataListeners.add(listener)
    return () => {
      this.disposedSubscriptions.data()
      this.dataListeners.delete(listener)
    }
  }

  public onExit(listener: (event: ExitEvent) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.disposedSubscriptions.exit()
      this.exitListeners.delete(listener)
    }
  }

  public onForeground(listener: (event: TerminalForegroundEvent) => void): () => void {
    this.foregroundListeners.add(listener)
    return () => {
      this.disposedSubscriptions.foreground()
      this.foregroundListeners.delete(listener)
    }
  }

  public emitData(event: DataEvent): void {
    this.dataListeners.forEach(listener => listener(event))
  }

  public emitExit(event: ExitEvent): void {
    this.exitListeners.forEach(listener => listener(event))
  }

  public emitForeground(event: TerminalForegroundEvent): void {
    this.foregroundListeners.forEach(listener => listener(event))
  }
}
