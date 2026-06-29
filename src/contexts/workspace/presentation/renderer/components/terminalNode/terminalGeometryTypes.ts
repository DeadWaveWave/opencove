import type { MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

export type PtySize = { cols: number; rows: number }

export type InitialTerminalNodeGeometryCommitResult = PtySize & { changed: boolean }

export type TerminalGeometryRefs = {
  terminalRef: MutableRefObject<Terminal | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastCommittedPtySizeRef: MutableRefObject<PtySize | null>
}

export type FitTerminalNodeOptions = {
  refreshWhenStable?: boolean
  logWhenStable?: boolean
}
