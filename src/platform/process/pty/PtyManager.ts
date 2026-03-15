import os from 'node:os'
import process from 'node:process'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'

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

  public write(sessionId: string, data: string): void {
    const pty = this.sessions.get(sessionId)
    if (!pty) {
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
