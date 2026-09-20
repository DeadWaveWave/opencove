import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { TerminalNodeData } from '../../../types'
import { resolveSpaceSummaryStatus } from './spaceSummary'

function makeNode(id: string, data: Partial<TerminalNodeData> = {}): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      sessionId: `session-${id}`,
      title: id,
      width: 600,
      height: 400,
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
      ...data,
    },
  }
}

const t = (key: string): string => key

describe('Compact window runtime status', () => {
  it('uses the authoritative Agent observation while leaving terminal session status distinct', () => {
    const agent = makeNode('agent', {
      kind: 'agent',
      status: 'running',
      agentRuntimeObservation: {
        status: 'waiting',
        source: 'session_file',
        hookInstallState: null,
        degraded: false,
      },
    })
    expect(resolveSpaceSummaryStatus(agent.data, t)).toEqual({
      state: 'waiting',
      label: 'agentRuntime.waiting',
    })
    expect(resolveSpaceSummaryStatus(makeNode('terminal').data, t)).toEqual({
      state: 'connected',
      label: 'spaceCollapse.terminalRunning',
    })
    expect(
      resolveSpaceSummaryStatus(makeNode('exited', { endedAt: '2026-09-19T00:00:00Z' }).data, t),
    ).toEqual({
      state: 'exited',
      label: 'spaceCollapse.terminalExited',
    })
    expect(resolveSpaceSummaryStatus(makeNode('doc', { kind: 'document' }).data, t)).toBeNull()
  })
})
