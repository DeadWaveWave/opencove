import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'

function captureTerminalVisibleText(terminal: Terminal): string {
  const activeBuffer = terminal.buffer?.active
  if (!activeBuffer || typeof activeBuffer.length !== 'number') {
    return ''
  }

  const lines: string[] = []

  for (let index = 0; index < activeBuffer.length; index += 1) {
    const line = activeBuffer.getLine(index)
    if (!line) {
      continue
    }

    lines.push(line.translateToString(true))
  }

  return lines.join('\n')
}

export function useTerminalTestTranscriptMirror({
  enabled,
  resetKey,
  terminalRef,
}: {
  enabled: boolean
  resetKey: string
  terminalRef: MutableRefObject<Terminal | null>
}): {
  transcriptRef: MutableRefObject<HTMLDivElement | null>
  scheduleTranscriptSync: () => void
} {
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const pendingFrameRef = useRef<number | null>(null)

  const cancelPendingSync = useCallback(() => {
    if (pendingFrameRef.current === null) {
      return
    }

    cancelAnimationFrame(pendingFrameRef.current)
    pendingFrameRef.current = null
  }, [])

  const scheduleTranscriptSync = useCallback(() => {
    if (!enabled || pendingFrameRef.current !== null) {
      return
    }

    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null

      const transcriptElement = transcriptRef.current
      if (!transcriptElement) {
        return
      }

      const terminal = terminalRef.current
      transcriptElement.textContent = terminal ? captureTerminalVisibleText(terminal) : ''
    })
  }, [enabled, terminalRef])

  useEffect(() => {
    cancelPendingSync()

    if (transcriptRef.current) {
      transcriptRef.current.textContent = ''
    }
  }, [cancelPendingSync, resetKey])

  useEffect(() => {
    if (enabled) {
      return () => {
        cancelPendingSync()
      }
    }

    cancelPendingSync()
    if (transcriptRef.current) {
      transcriptRef.current.textContent = ''
    }

    return () => undefined
  }, [cancelPendingSync, enabled])

  return {
    transcriptRef,
    scheduleTranscriptSync,
  }
}
