import { describe, expect, it } from 'vitest'
import { mergeHydratedNode } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

function createRuntimeNode(overrides: Partial<TerminalNodeData>): {
  id: string
  type: string
  position: { x: number; y: number }
  data: TerminalNodeData
} {
  return {
    id: 'terminal-node-1',
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      title: 'terminal',
      width: 520,
      height: 360,
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

describe('mergeHydratedNode', () => {
  it('keeps worker-prepared terminal geometry in the runtime node projection', () => {
    const merged = mergeHydratedNode(
      createRuntimeNode({ terminalGeometry: null }),
      createRuntimeNode({
        sessionId: 'runtime-session',
        terminalGeometry: { cols: 72, rows: 20 },
      }),
    )

    expect(merged.data.terminalGeometry).toEqual({ cols: 72, rows: 20 })
  })
})
