import type { Node } from '@xyflow/react'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TerminalNodeData } from '../../../types'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import { assignAgentNodeToTaskSpace } from './useTaskActions.agentSession.shared'

// `pnpm check` compiles this file: each directive below fails the build as an unused directive
// when the parameter it names comes back.

describe('the Space assignment takes its node from the document (#758)', () => {
  it('has no createdNode parameter: the recipe reads the node by createdNodeId', () => {
    const assign = (): void =>
      assignNodeToSpaceAndExpand({
        createdNodeId: 'node-1',
        targetSpaceId: 'space-1',
        // @ts-expect-error -- createdNode is retired; the recipe reads the node by createdNodeId (#758)
        createdNode: {} as Node<TerminalNodeData>,
        updateCanvasDocument: () => undefined,
      })

    expect(typeof assign).toBe('function')
  })

  it('has no assignedNode parameter on the task agent assignment', () => {
    const assign = (): void =>
      assignAgentNodeToTaskSpace({
        taskNodeId: 'task-1',
        assignedNodeId: 'agent-1',
        // @ts-expect-error -- assignedNode is retired; the recipe reads the node by assignedNodeId (#758)
        assignedNode: {} as Node<TerminalNodeData>,
        context: {
          workspaceId: 'workspace-1',
          readDocument: () => ({ nodes: [], spaces: [] }) as never,
          updateCanvasDocument: () => undefined,
        },
      })

    expect(typeof assign).toBe('function')
  })

  it('names neither parameter among its keys, whatever else is wrong on a line', () => {
    // A directive above is consumed by any error on its line, so an optional parameter of another
    // type could come back unnoticed. The keys themselves cannot.
    type AssignInput = Parameters<typeof assignNodeToSpaceAndExpand>[0]
    type TaskAssignInput = Parameters<typeof assignAgentNodeToTaskSpace>[0]
    expectTypeOf<'createdNode' extends keyof AssignInput ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<
      'assignedNode' extends keyof TaskAssignInput ? true : false
    >().toEqualTypeOf<false>()
  })
})
