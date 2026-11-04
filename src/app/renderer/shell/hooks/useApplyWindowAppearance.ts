import { useLayoutEffect } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { useSystemReducedTransparency } from './useReducedTransparency'

/**
 * Root attributes the window and material styles read:
 * - `data-cove-kind-colors`: "off" keeps window tiles and header tints neutral.
 * - `data-cove-transparency`: "reduced" when the setting or the system reduces transparency, so
 *   glass turns opaque and nothing is blurred. The system preference is followed live.
 */
export function useApplyWindowAppearance({
  windowKindColorsEnabled,
  reduceTransparency,
}: Pick<AgentSettings, 'windowKindColorsEnabled' | 'reduceTransparency'>): void {
  const systemReducesTransparency = useSystemReducedTransparency()
  const reduced = reduceTransparency || systemReducesTransparency

  useLayoutEffect(() => {
    document.documentElement.dataset.coveKindColors = windowKindColorsEnabled ? 'on' : 'off'
  }, [windowKindColorsEnabled])

  useLayoutEffect(() => {
    document.documentElement.dataset.coveTransparency = reduced ? 'reduced' : 'full'
  }, [reduced])
}
