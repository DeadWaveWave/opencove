import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  resolveCanvasVisualCenter,
  resolveCycledSpaceId,
  resolveIdleSpaceIds,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useShortcuts.helpers'

function createNode(
  id: string,
  kind: TerminalNodeData['kind'],
  status: TerminalNodeData['status'] = null,
): Node<TerminalNodeData> {
  return {
    id,
    type: kind === 'note' ? 'noteNode' : 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: id,
      title: id,
      width: 100,
      height: 100,
      kind,
      status,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
    },
  }
}

describe('workspace canvas shortcut helpers', () => {
  it('resolves the visual center of the canvas rect', () => {
    expect(
      resolveCanvasVisualCenter({
        left: 120,
        top: 40,
        width: 800,
        height: 600,
      }),
    ).toEqual({
      x: 520,
      y: 340,
    })
  })

  it('cycles spaces forward and backward without All', () => {
    const spaceIds = ['space-1', 'space-2', 'space-3']

    expect(
      resolveCycledSpaceId({
        direction: 'next',
        activeSpaceId: null,
        spaceIds,
      }),
    ).toBe('space-1')

    expect(
      resolveCycledSpaceId({
        direction: 'previous',
        activeSpaceId: null,
        spaceIds,
      }),
    ).toBe('space-3')

    expect(
      resolveCycledSpaceId({
        direction: 'next',
        activeSpaceId: 'space-3',
        spaceIds,
      }),
    ).toBe('space-1')

    expect(
      resolveCycledSpaceId({
        direction: 'previous',
        activeSpaceId: 'space-1',
        spaceIds,
      }),
    ).toBe('space-3')
  })

  it('returns only spaces that do not contain working agents', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-idle',
        name: 'Idle',
        directoryPath: '/tmp/idle',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['note-1'],
        rect: null,
      },
      {
        id: 'space-working',
        name: 'Working',
        directoryPath: '/tmp/working',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['agent-1'],
        rect: null,
      },
      {
        id: 'space-standby',
        name: 'Standby',
        directoryPath: '/tmp/standby',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['agent-2'],
        rect: null,
      },
    ]

    const workingAgent = createNode('agent-1', 'agent', 'running')
    workingAgent.data.agent = {
      provider: 'codex',
      prompt: 'working',
      model: null,
      effectiveModel: null,
      launchMode: 'new',
      resumeSessionId: null,
      executionDirectory: '/tmp/working',
      expectedDirectory: '/tmp/working',
      directoryMode: 'workspace',
      customDirectory: null,
      shouldCreateDirectory: false,
      taskId: null,
    }

    const standbyAgent = createNode('agent-2', 'agent', 'standby')
    standbyAgent.data.agent = {
      provider: 'codex',
      prompt: 'standby',
      model: null,
      effectiveModel: null,
      launchMode: 'new',
      resumeSessionId: null,
      executionDirectory: '/tmp/standby',
      expectedDirectory: '/tmp/standby',
      directoryMode: 'workspace',
      customDirectory: null,
      shouldCreateDirectory: false,
      taskId: null,
    }

    expect(
      resolveIdleSpaceIds({
        spaces,
        nodes: [createNode('note-1', 'note'), workingAgent, standbyAgent],
      }),
    ).toEqual(['space-idle', 'space-standby'])
  })
})
