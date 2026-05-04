import type {
  AgentProvider,
  normalizeAgentSettings,
} from '../../../../contexts/settings/domain/agentSettings'
import { resolveTerminalPtyGeometryForNodeFrame } from '../../../../contexts/workspace/domain/terminalPtyGeometry'
import { resolveAgentNodeMinSize } from '../../../../contexts/workspace/domain/workspaceNodeSizing'
import type { NormalizedPersistedNode } from './sessionPrepareOrReviveShared'

export {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
} from '../../../../contexts/workspace/domain/terminalPtyGeometry'

export type PtyGeometry = { cols: number; rows: number }

export function resolveNodeInitialPtyGeometry(
  node: NormalizedPersistedNode,
  settings: ReturnType<typeof normalizeAgentSettings>,
  _agentProvider?: AgentProvider | null,
): PtyGeometry {
  const minSize = node.kind === 'agent' ? resolveAgentNodeMinSize() : { width: 0, height: 0 }
  const frameGeometry = resolveTerminalPtyGeometryForNodeFrame({
    width: Math.max(node.width, minSize.width),
    height: Math.max(node.height, minSize.height),
    terminalFontSize: settings.terminalFontSize,
  })

  if (!node.terminalGeometry) {
    return frameGeometry
  }

  return node.terminalGeometry
}
