import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult } from '../../../shared/contracts/dto'
import type { TerminalCanonicalPtyGeometry } from '../../../shared/contracts/dto'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : fallback
}

export type TerminalPresentationGeometryCommitResult = {
  status: 'accepted' | 'superseded'
  changed: boolean
  geometry: TerminalCanonicalPtyGeometry
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
  private geometryRevision: number | null = null

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

  public resize(
    cols: number,
    rows: number,
    revision?: number | null,
  ): { cols: number; rows: number; changed: boolean; revision: number | null } {
    const nextRevision =
      typeof revision === 'number' && Number.isFinite(revision) && revision > 0
        ? Math.floor(revision)
        : null
    if (
      nextRevision !== null &&
      this.geometryRevision !== null &&
      nextRevision < this.geometryRevision
    ) {
      return {
        cols: this.cols,
        rows: this.rows,
        changed: false,
        revision: this.geometryRevision,
      }
    }

    const nextCols = normalizePositiveInt(cols, this.cols || DEFAULT_COLS)
    const nextRows = normalizePositiveInt(rows, this.rows || DEFAULT_ROWS)

    if (nextCols === this.cols && nextRows === this.rows) {
      if (nextRevision !== null) {
        this.geometryRevision = nextRevision
      }
      return {
        cols: this.cols,
        rows: this.rows,
        changed: false,
        revision: this.geometryRevision,
      }
    }

    this.cols = nextCols
    this.rows = nextRows
    if (nextRevision !== null) {
      this.geometryRevision = nextRevision
    }

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
      revision: this.geometryRevision,
    }
  }

  public planGeometryCommit(options: {
    cols: number
    rows: number
    baseGeometryRevision?: number | null
  }): TerminalPresentationGeometryCommitResult {
    const hasBaseGeometryRevision = options.baseGeometryRevision !== undefined
    const baseGeometryRevision =
      options.baseGeometryRevision === null
        ? null
        : typeof options.baseGeometryRevision === 'number' &&
            Number.isFinite(options.baseGeometryRevision) &&
            options.baseGeometryRevision > 0
          ? Math.floor(options.baseGeometryRevision)
          : undefined

    if (hasBaseGeometryRevision && baseGeometryRevision !== this.geometryRevision) {
      return {
        status: 'superseded',
        changed: false,
        geometry: {
          cols: this.cols,
          rows: this.rows,
          revision: this.geometryRevision,
        },
      }
    }

    const cols = normalizePositiveInt(options.cols, this.cols || DEFAULT_COLS)
    const rows = normalizePositiveInt(options.rows, this.rows || DEFAULT_ROWS)
    return {
      status: 'accepted',
      changed: cols !== this.cols || rows !== this.rows,
      geometry: {
        cols,
        rows,
        revision: this.geometryRevision,
      },
    }
  }

  public getGeometry(): TerminalCanonicalPtyGeometry {
    return {
      cols: this.cols,
      rows: this.rows,
      revision: this.geometryRevision,
    }
  }

  public commitGeometry(options: {
    cols: number
    rows: number
    baseGeometryRevision?: number | null
  }): TerminalPresentationGeometryCommitResult {
    const plan = this.planGeometryCommit(options)
    if (plan.status === 'superseded' || !plan.changed) {
      return plan
    }

    this.cols = plan.geometry.cols
    this.rows = plan.geometry.rows
    this.geometryRevision = (this.geometryRevision ?? 0) + 1
    const revision = this.geometryRevision
    const cols = this.cols
    const rows = this.rows

    void this.enqueue(() => {
      if (cols === this.terminal.cols && rows === this.terminal.rows) {
        return
      }

      this.terminal.resize(cols, rows)
      this.presentationRevision += 1
    })

    return {
      status: 'accepted',
      changed: true,
      geometry: { cols, rows, revision },
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
      geometryRevision: this.geometryRevision,
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
