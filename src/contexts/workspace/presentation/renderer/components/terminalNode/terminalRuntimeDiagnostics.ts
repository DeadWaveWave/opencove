import type { Terminal } from '@xterm/xterm'
import { containsMeaningfulTerminalDisplayContent } from './hydrationReplacement'

export function formatTerminalDataHeadHex(data: string): string {
  return Array.from(data.slice(0, 24))
    .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(' ')
}

export function hasVisibleTerminalBufferContent(terminal: Terminal): boolean {
  const activeBuffer = terminal.buffer?.active
  if (!activeBuffer || typeof activeBuffer.length !== 'number') {
    return false
  }

  for (let index = 0; index < activeBuffer.length; index += 1) {
    const line = activeBuffer.getLine(index)
    const text = line?.translateToString(true) ?? ''
    if (containsMeaningfulTerminalDisplayContent(text)) {
      return true
    }
  }

  return false
}
