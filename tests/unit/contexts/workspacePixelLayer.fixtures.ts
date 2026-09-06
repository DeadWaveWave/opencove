import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

export function pixelNode(overrides: Partial<TerminalNodeData> = {}): Node<TerminalNodeData> {
  return {
    id: 'terminal-1',
    position: { x: 100, y: 80 },
    data: {
      sessionId: 'session-1',
      title: 'Terminal',
      width: 300,
      height: 200,
      kind: 'terminal',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
      ...overrides,
    },
  }
}
