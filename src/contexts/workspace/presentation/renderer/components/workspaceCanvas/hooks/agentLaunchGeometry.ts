import type {
  AgentProvider,
  StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { resolveTerminalPtyGeometryForNodeFrame } from '@contexts/workspace/domain/terminalPtyGeometry'
import type { TerminalPtyGeometry } from '@shared/contracts/dto'
import type { Size } from '../../../types'
import { resolveDefaultAgentWindowSize } from '../constants'

export interface AgentLaunchGeometry {
  frameSize: Size
  terminalGeometry: TerminalPtyGeometry
}

export function resolveAgentLaunchGeometryForFrame({
  frameSize,
  terminalFontSize,
}: {
  frameSize: Size
  terminalFontSize: number
}): AgentLaunchGeometry {
  return {
    frameSize,
    terminalGeometry: resolveTerminalPtyGeometryForNodeFrame({
      width: frameSize.width,
      height: frameSize.height,
      terminalFontSize,
    }),
  }
}

export function resolveDefaultAgentLaunchGeometry({
  bucket,
  provider,
  terminalFontSize,
}: {
  bucket: StandardWindowSizeBucket
  provider?: AgentProvider | null
  terminalFontSize: number
}): AgentLaunchGeometry {
  return resolveAgentLaunchGeometryForFrame({
    frameSize: resolveDefaultAgentWindowSize(bucket, provider),
    terminalFontSize,
  })
}
