import type { normalizeAgentSettings } from '../../../../contexts/settings/domain/agentSettings'
import { resolveTerminalPtyGeometryForNodeFrame } from '../../../../contexts/workspace/domain/terminalPtyGeometry'
import type { NormalizedPersistedNode } from './sessionPrepareOrReviveShared'

export {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
} from '../../../../contexts/workspace/domain/terminalPtyGeometry'

export type PtyGeometry = { cols: number; rows: number }

export function resolveNodeInitialPtyGeometry(
  node: NormalizedPersistedNode,
  settings: ReturnType<typeof normalizeAgentSettings>,
): PtyGeometry {
  const frameGeometry = resolveTerminalPtyGeometryForNodeFrame({
    width: node.width,
    height: node.height,
    terminalFontSize: settings.terminalFontSize,
  })

  if (!node.terminalGeometry) {
    return frameGeometry
  }

  return {
    cols: Math.min(node.terminalGeometry.cols, frameGeometry.cols),
    rows: Math.min(node.terminalGeometry.rows, frameGeometry.rows),
  }
}
