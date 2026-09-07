import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { resolveWorkspaceCanvasViewportAnimation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'

afterEach(() => {
  useAppStore.setState({ agentSettings: DEFAULT_AGENT_SETTINGS })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.opencoveTestViewportAnimation
})

describe('viewport animation policy', () => {
  it('reads the latest preference for every navigation without moving the viewport on change', () => {
    expect(resolveWorkspaceCanvasViewportAnimation(220)).toEqual({
      duration: 220,
      interpolate: 'smooth',
    })
    useAppStore.setState({
      agentSettings: { ...DEFAULT_AGENT_SETTINGS, viewportTransition: 'slide' },
    })
    expect(resolveWorkspaceCanvasViewportAnimation(120)).toEqual({
      duration: 120,
      interpolate: 'linear',
    })
  })

  it('respects reduced motion even when real test animations are enabled', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    document.documentElement.dataset.opencoveTestViewportAnimation = 'true'
    expect(resolveWorkspaceCanvasViewportAnimation(220).duration).toBe(0)
  })

  it('keeps ordinary E2E instantaneous but allows opt-in motion assertions', () => {
    vi.stubGlobal('opencoveApi', { meta: { isTest: true } })
    expect(resolveWorkspaceCanvasViewportAnimation(220).duration).toBe(0)
    document.documentElement.dataset.opencoveTestViewportAnimation = 'true'
    expect(resolveWorkspaceCanvasViewportAnimation(220).duration).toBe(220)
  })
})
