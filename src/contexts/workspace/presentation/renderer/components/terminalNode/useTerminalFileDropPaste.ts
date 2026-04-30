import { useEffect, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'

function quoteShellPath(path: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(path) ? path : "'" + path.replace(/'/g, "'\\''") + "'"
}

export function useTerminalFileDropPaste({
  containerRef,
  terminalRef,
}: {
  containerRef: RefObject<HTMLElement | null>
  terminalRef: RefObject<Terminal | null>
}): void {
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }

    const handleDragOver = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }

    const handleDrop = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      const files = event.dataTransfer?.files
      if (!files || files.length === 0) {
        return
      }

      const paths = Array.from(files)
      const paths = Array.from(files)
        .map(file => window.opencoveApi.filesystem.getPathForFile(file))
        .filter(path => path.length > 0)
        .map(quoteShellPath)
        .join(' ')

      if (paths.length > 0) {
        terminalRef.current?.paste(paths)
      }
    }

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)
    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
    }
  }, [containerRef, terminalRef])
}
