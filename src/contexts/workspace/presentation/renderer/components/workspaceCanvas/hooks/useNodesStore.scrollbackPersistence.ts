import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import {
  scheduleAgentPlaceholderScrollbackWrite,
  scheduleNodeScrollbackWrite,
} from '../../../utils/persistence/scrollbackSchedule'

export function persistNodeScrollback(
  node: Node<TerminalNodeData>,
  scrollback: string | null,
): void {
  if (node.data.kind === 'terminal') {
    scheduleNodeScrollbackWrite(node.id, scrollback)
    return
  }

  if (node.data.kind === 'agent') {
    scheduleAgentPlaceholderScrollbackWrite(node.id, scrollback)
  }
}
