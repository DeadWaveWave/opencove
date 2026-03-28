import type { Terminal } from '@xterm/xterm'

function syncAgentAltBufferMarker(
  container: HTMLElement,
  isAgentNode: boolean,
  bufferType: 'normal' | 'alternate',
): void {
  if (!isAgentNode || bufferType !== 'alternate') {
    container.removeAttribute('data-cove-agent-alt-buffer')
    return
  }

  container.setAttribute('data-cove-agent-alt-buffer', 'true')
}

export function bindAgentCursorVisibility({
  terminal,
  container,
  isAgentNode,
}: {
  terminal: Terminal
  container: HTMLElement
  isAgentNode: boolean
}): () => void {
  syncAgentAltBufferMarker(container, isAgentNode, terminal.buffer.active.type)

  if (!isAgentNode) {
    return () => undefined
  }

  const disposable = terminal.buffer.onBufferChange(buffer => {
    syncAgentAltBufferMarker(container, true, buffer.type)
  })

  return () => {
    disposable.dispose()
    container.removeAttribute('data-cove-agent-alt-buffer')
  }
}
