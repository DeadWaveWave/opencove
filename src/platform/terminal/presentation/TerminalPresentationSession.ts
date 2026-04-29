import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult } from '../../../shared/contracts/dto'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : fallback
}

export class TerminalPresentationSession {
  private readonly sessionId: string
  private readonly terminal: Terminal
  private readonly serializeAddon: SerializeAddon
  private operationChain: Promise<void> = Promise.resolve()
  private presentationRevision = 0
  private appliedSeq = 0
  private epoch = 1
  private title: string | null = null
  private disposed = false
  private cols: number
  private rows: number

  public constructor(options: { sessionId: string; cols?: number; rows?: number }) {
    this.sessionId = options.sessionId

    this.terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cols: normalizePositiveInt(options.cols ?? DEFAULT_COLS, DEFAULT_COLS),
      rows: normalizePositiveInt(options.rows ?? DEFAULT_ROWS, DEFAULT_ROWS),
      scrollback: 5_000,
    })
    this.cols = this.terminal.cols
    this.rows = this.terminal.rows

    this.serializeAddon = new SerializeAddon()
    this.terminal.loadAddon(this.serializeAddon)
    this.terminal.onTitleChange(title => {
      this.title = title.length > 0 ? title : null
      this.presentationRevision += 1
    })
  }

  private enqueue(operation: () => void | Promise<void>): Promise<void> {
    const nextOperation = this.operationChain.then(async () => {
      if (this.disposed) {
        return
      }

      await operation()
    })

    this.operationChain = nextOperation.catch(() => undefined)
    return nextOperation
  }

  public async applyOutput(seq: number, data: string): Promise<void> {
    if (data.length === 0) {
      return
    }

    const normalizedSeq =
      Number.isFinite(seq) && seq > 0 ? Math.max(0, Math.floor(seq)) : this.appliedSeq

    await this.enqueue(
      async () =>
        await new Promise<void>(resolve => {
          this.terminal.write(data, () => {
            this.appliedSeq = Math.max(this.appliedSeq, normalizedSeq)
            this.presentationRevision += 1
            resolve()
          })
        }),
    )
  }

  public resize(cols: number, rows: number): { cols: number; rows: number; changed: boolean } {
    const nextCols = normalizePositiveInt(cols, this.cols || DEFAULT_COLS)
    const nextRows = normalizePositiveInt(rows, this.rows || DEFAULT_ROWS)

    if (nextCols === this.cols && nextRows === this.rows) {
      return {
        cols: this.cols,
        rows: this.rows,
        changed: false,
      }
    }

    this.cols = nextCols
    this.rows = nextRows

    void this.enqueue(() => {
      if (nextCols === this.terminal.cols && nextRows === this.terminal.rows) {
        return
      }

      this.terminal.resize(nextCols, nextRows)
      this.presentationRevision += 1
    })

    return {
      cols: nextCols,
      rows: nextRows,
      changed: true,
    }
  }

  public async flush(): Promise<void> {
    await this.operationChain
  }

  public async snapshot(): Promise<PresentationSnapshotTerminalResult> {
    await this.flush()

    return {
      sessionId: this.sessionId,
      epoch: this.epoch,
      appliedSeq: this.appliedSeq,
      presentationRevision: this.presentationRevision,
      cols: this.cols,
      rows: this.rows,
      bufferKind: this.terminal.buffer.active.type ?? 'unknown',
      cursor: {
        x: this.terminal.buffer.active.cursorX,
        y: this.terminal.buffer.active.cursorY,
      },
      title: this.title,
      serializedScreen: this.serializeAddon.serialize(),
    }
  }

  public dispose(): void {
    this.disposed = true
    this.terminal.dispose()
  }
}
