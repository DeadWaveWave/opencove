import { describe, expect, it } from 'vitest'
import { mergeHydratedNode } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { repairRuntimeNodeFrame } from '../../../src/app/renderer/shell/hooks/runtimeNodeFrameRepair'
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

describe('repairRuntimeNodeFrame', () => {
  it('does not widen persisted OpenCode agent nodes beyond canonical agent sizing', () => {
    const repaired = repairRuntimeNodeFrame(
      createRuntimeNode({
        kind: 'agent',
        width: 516,
        height: 724,
        agent: {
          provider: 'opencode',
          prompt: '',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
          executionDirectory: 'D:\\Development\\opencove',
          expectedDirectory: 'D:\\Development\\opencove',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
      }) as never,
    )

    expect(repaired.data.width).toBe(516)
    expect(repaired.data.height).toBe(724)
    expect(repaired.initialWidth).toBeUndefined()
    expect(repaired.initialHeight).toBeUndefined()
  })

  it('repairs undersized agent nodes to the canonical minimum frame', () => {
    const repaired = repairRuntimeNodeFrame(
      createRuntimeNode({
        kind: 'agent',
        width: 360,
        height: 500,
        agent: {
          provider: 'opencode',
          prompt: '',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          resumeSessionIdVerified: false,
          executionDirectory: 'D:\\Development\\opencove',
          expectedDirectory: 'D:\\Development\\opencove',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
      }) as never,
    )

    expect(repaired.data.width).toBe(400)
    expect(repaired.data.height).toBe(520)
    expect(repaired.initialWidth).toBe(400)
    expect(repaired.initialHeight).toBe(520)
  })
})
