import { useLayoutEffect } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { useSystemReducedTransparency } from './useReducedTransparency'

/**
 * Root attributes the window and material styles read:
 * - `data-cove-kind-colors`: "off" keeps window tiles and header tints neutral.
 * - `data-cove-transparency`: "reduced" for solid windows, chosen or because the system reduces
 *   transparency; glass turns opaque and nothing is blurred. The system is followed live.
 */
export function useApplyWindowAppearance({
  windowKindColorsEnabled,
  windowMaterial,
}: Pick<AgentSettings, 'windowKindColorsEnabled' | 'windowMaterial'>): void {
  const systemReducesTransparency = useSystemReducedTransparency()
  const reduced = windowMaterial === 'solid' || systemReducesTransparency

  useLayoutEffect(() => {
    document.documentElement.dataset.coveKindColors = windowKindColorsEnabled ? 'on' : 'off'
  }, [windowKindColorsEnabled])

  useLayoutEffect(() => {
    document.documentElement.dataset.coveTransparency = reduced ? 'reduced' : 'full'
  }, [reduced])
}
