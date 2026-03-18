import os from 'node:os'
import process from 'node:process'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'
import type { TerminalWriteEncoding } from '../../../shared/contracts/dto'

export interface SpawnPtyOptions {
  cwd: string
  shell?: string
  command?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
}

const MAX_SNAPSHOT_CHARS = 400_000

interface SnapshotState {
  chunks: string[]
  head: number
  length: number
}

function trimSnapshot(state: SnapshotState): void {
  if (state.length <= MAX_SNAPSHOT_CHARS) {
    return
  }

  let excess = state.length - MAX_SNAPSHOT_CHARS

  while (excess > 0 && state.head < state.chunks.length) {
    const headChunk = state.chunks[state.head] ?? ''
    if (headChunk.length <= excess) {
      excess -= headChunk.length
      state.length -= headChunk.length
      state.head += 1
      continue
    }

    state.chunks[state.head] = headChunk.slice(excess)
    state.length -= excess
    excess = 0
  }

  if (state.head > 64) {
    state.chunks = state.chunks.slice(state.head)
    state.head = 0
  }
}

export class PtyManager {
  private sessions = new Map<string, IPty>()
  private snapshots = new Map<string, SnapshotState>()

  public spawnSession(options: SpawnPtyOptions): { sessionId: string; pty: IPty } {
    const sessionId = crypto.randomUUID()
    const command = options.command ?? options.shell ?? this.resolveDefaultShell()
    const args = options.command ? (options.args ?? []) : []

    const pty = spawn(command, args, {
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env ?? process.env,
      name: 'xterm-256color',
    })

    this.sessions.set(sessionId, pty)
    this.snapshots.set(sessionId, { chunks: [], head: 0, length: 0 })

    return { sessionId, pty }
  }

  public appendSnapshotData(sessionId: string, data: string): void {
    if (!this.sessions.has(sessionId)) {
      return
    }

    const snapshot = this.snapshots.get(sessionId)
    if (!snapshot) {
      return
    }

    if (data.length >= MAX_SNAPSHOT_CHARS) {
      snapshot.chunks = [data.slice(-MAX_SNAPSHOT_CHARS)]
      snapshot.head = 0
      snapshot.length = MAX_SNAPSHOT_CHARS
      return
    }

    snapshot.chunks.push(data)
    snapshot.length += data.length
    trimSnapshot(snapshot)
  }

  public snapshot(sessionId: string): string {
    const snapshot = this.snapshots.get(sessionId)
    if (!snapshot || snapshot.length === 0 || snapshot.head >= snapshot.chunks.length) {
      return ''
    }

    return snapshot.chunks.slice(snapshot.head).join('')
  }

  public write(sessionId: string, data: string, encoding: TerminalWriteEncoding = 'utf8'): void {
    const pty = this.sessions.get(sessionId)
    if (!pty) {
      return
    }

    if (encoding === 'binary') {
      if (process.platform === 'win32') {
        // ConPTY can be unreliable with xterm-style "binary" input that includes bytes >= 0x80,
        // which is common for X10 mouse reports (coordinates are 32-255).
        //
        // When we see an X10 mouse report with high bytes, translate it into the SGR (1006) form
        // which is 7-bit clean and widely supported by TUIs.
        pty.write(convertHighByteX10MouseReportsToSgr(data))
      } else {
        // xterm onBinary emits byte-oriented strings; preserve those bytes for POSIX PTYs.
        pty.write(Buffer.from(data, 'binary'))
      }
      return
    }

    pty.write(data)
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const pty = this.sessions.get(sessionId)
    if (!pty) {
      return
    }

    pty.resize(cols, rows)
  }

  public kill(sessionId: string): void {
    const pty = this.sessions.get(sessionId)
    if (pty) {
      pty.kill()
      this.sessions.delete(sessionId)
    }

    this.snapshots.delete(sessionId)
  }

  public delete(sessionId: string, options: { keepSnapshot?: boolean } = {}): void {
    this.sessions.delete(sessionId)
    if (options.keepSnapshot !== true) {
      this.snapshots.delete(sessionId)
    }
  }

  public disposeAll(): void {
    for (const [sessionId, pty] of this.sessions.entries()) {
      pty.kill()
      this.sessions.delete(sessionId)
      this.snapshots.delete(sessionId)
    }

    this.snapshots.clear()
  }

  private resolveDefaultShell(): string {
    if (process.platform === 'win32') {
      return 'powershell.exe'
    }

    return process.env.SHELL || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash')
  }
}

function convertHighByteX10MouseReportsToSgr(data: string): string {
  // X10 mouse report: ESC [ M + 3 bytes where each byte is 32-255:
  // - button + 32
  // - x + 32 (1-indexed cell coords)
  // - y + 32 (1-indexed cell coords)
  //
  // For coordinates beyond 95, x/y bytes exceed 0x7F. Convert those reports to SGR:
  //   ESC [ < button ; x ; y M
  // which stays ASCII-only.
  const prefix = '\u001b[M'
  let cursor = 0
  let converted = ''

  while (cursor < data.length) {
    const nextIndex = data.indexOf(prefix, cursor)
    if (nextIndex === -1) {
      converted += data.slice(cursor)
      break
    }

    converted += data.slice(cursor, nextIndex)

    if (nextIndex + 5 >= data.length) {
      converted += data.slice(nextIndex)
      break
    }

    const buttonByte = data.charCodeAt(nextIndex + 3)
    const xByte = data.charCodeAt(nextIndex + 4)
    const yByte = data.charCodeAt(nextIndex + 5)

    const isCandidate =
      buttonByte >= 32 &&
      buttonByte <= 255 &&
      xByte >= 32 &&
      xByte <= 255 &&
      yByte >= 32 &&
      yByte <= 255

    if (!isCandidate) {
      converted += prefix
      cursor = nextIndex + prefix.length
      continue
    }

    const hasHighByte = buttonByte > 127 || xByte > 127 || yByte > 127
    if (!hasHighByte) {
      converted += data.slice(nextIndex, nextIndex + 6)
      cursor = nextIndex + 6
      continue
    }

    const button = buttonByte - 32
    const x = xByte - 32
    const y = yByte - 32
    converted += `\u001b[<${button};${x};${y}M`
    cursor = nextIndex + 6
  }

  return converted
}
