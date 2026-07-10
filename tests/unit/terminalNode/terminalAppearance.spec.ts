import { describe, expect, it, vi } from 'vitest'
import { UI_THEME_DESCRIPTORS } from '@/contexts/settings/domain/uiSettings'
import {
  createTerminalAppearanceOwner,
  createTerminalAppearanceRefreshCoordinator,
  resolveDesiredTerminalAppearanceValue,
  resolveTerminalAppearanceValue,
  type TerminalAppearanceValue,
} from '@/contexts/workspace/presentation/renderer/components/terminalNode/terminalAppearance'

const DARK_THEME = {
  background: '#15110e',
  foreground: '#d4c4ae',
  cursor: '#d4c4ae',
  selectionBackground: 'rgba(203, 131, 85, 0.32)',
}

function createValue(overrides: Partial<TerminalAppearanceValue> = {}): TerminalAppearanceValue {
  return {
    themeId: 'ember-light',
    uiScheme: 'light',
    terminalScheme: 'dark',
    xtermTheme: DARK_THEME,
    cssTokens: {},
    ...overrides,
  }
}

describe('terminal appearance', () => {
  it('declares ember-light as a light UI theme with an explicitly dark terminal', () => {
    expect(UI_THEME_DESCRIPTORS['ember-light']).toMatchObject({
      baseScheme: 'light',
      terminalScheme: 'dark',
    })

    expect(
      resolveTerminalAppearanceValue({
        themeId: 'ember-light',
        uiScheme: 'light',
        terminalThemeMode: 'sync-with-ui',
        xtermTheme: DARK_THEME,
      }),
    ).toEqual(createValue())
  })

  it('shares one desired CSS probe within a microtask and never leaves the probe mounted', async () => {
    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'light'
    document.documentElement.style.setProperty('--cove-terminal-background', '#fbfcff')
    document.documentElement.style.setProperty('--cove-terminal-foreground', '#111827')
    document.documentElement.style.setProperty('--cove-terminal-cursor', '#111827')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(94, 156, 255, 0.24)',
    )
    const sourceScope = document.createElement('div')
    sourceScope.className = 'terminal-node appearance-cache-test'
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle')

    const first = resolveDesiredTerminalAppearanceValue({
      terminalThemeMode: 'sync-with-ui',
      sourceScope,
    })
    const second = resolveDesiredTerminalAppearanceValue({
      terminalThemeMode: 'sync-with-ui',
      sourceScope,
    })

    expect(second).toBe(first)
    expect(getComputedStyleSpy).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-cove-terminal-theme-probe]')).toBeNull()

    await Promise.resolve()
    const afterMicrotask = resolveDesiredTerminalAppearanceValue({
      terminalThemeMode: 'sync-with-ui',
      sourceScope,
    })
    expect(afterMicrotask).not.toBe(first)
    expect(getComputedStyleSpy).toHaveBeenCalledTimes(2)
    getComputedStyleSpy.mockRestore()
    ;[
      '--cove-terminal-background',
      '--cove-terminal-foreground',
      '--cove-terminal-cursor',
      '--cove-terminal-selection',
    ].forEach(variable => document.documentElement.style.removeProperty(variable))
  })

  it('uses one monotonic owner for desired and applied snapshots', () => {
    const owner = createTerminalAppearanceOwner(createValue(), { initiallyApplied: true })
    const initial = owner.getAppliedSnapshot()

    expect(initial).toMatchObject({ revision: 1, themeId: 'ember-light' })
    expect(owner.update(createValue())).toBe(initial)

    const next = owner.update(createValue({ themeId: 'ember' }))
    expect(next.revision).toBe(2)
    expect(owner.getAppliedSnapshot()).toBe(initial)
    expect(owner.markApplied(next)).toBe(true)
    expect(owner.getAppliedSnapshot()).toBe(next)

    const stale = { ...initial!, revision: 1 }
    expect(owner.markApplied(stale)).toBe(false)
    expect(owner.getAppliedSnapshot()).toBe(next)
  })

  it('coalesces requests to the final snapshot and cancels late work on dispose', () => {
    let nextFrameId = 1
    const frames = new Map<number, FrameRequestCallback>()
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    })
    const cancelFrame = vi.fn((id: number) => frames.delete(id))
    const runNextFrame = () => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      expect(entry).toBeDefined()
      frames.delete(entry![0])
      entry![1](performance.now())
    }

    const owner = createTerminalAppearanceOwner(createValue(), { initiallyApplied: true })
    const apply = vi.fn()
    const clearTextureAtlas = vi.fn()
    const refresh = vi.fn()
    const inspect = vi.fn()
    const coordinator = createTerminalAppearanceRefreshCoordinator({
      owner,
      requestFrame,
      cancelFrame,
      apply,
      clearTextureAtlas,
      refresh,
      inspect,
    })

    const revision2 = owner.update(createValue({ themeId: 'ember' }))
    const revision3 = owner.update(
      createValue({
        themeId: 'dark',
        xtermTheme: { ...DARK_THEME, background: '#0a0f1d' },
      }),
    )
    coordinator.request(revision2)
    coordinator.request(revision3)
    coordinator.request(revision2)

    expect(requestFrame).toHaveBeenCalledTimes(1)
    runNextFrame()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(revision3)
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(owner.getAppliedSnapshot()).toBe(revision3)

    runNextFrame()
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledWith(revision3)

    const revision4 = owner.update(createValue({ themeId: 'light', terminalScheme: 'light' }))
    coordinator.request(revision4)
    coordinator.dispose()
    expect(frames.size).toBe(0)
    expect(cancelFrame).toHaveBeenCalled()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('can apply logical appearance immediately while animation frames are suspended', () => {
    const owner = createTerminalAppearanceOwner(createValue(), { initiallyApplied: true })
    const apply = vi.fn()
    const refresh = vi.fn()
    const requestFrame = vi.fn(() => 1)
    const coordinator = createTerminalAppearanceRefreshCoordinator({
      owner,
      apply,
      refresh,
      requestFrame,
      cancelFrame: vi.fn(),
    })
    const next = owner.update(createValue({ themeId: 'ember' }))

    coordinator.setVisible(false)
    coordinator.request(next)
    expect(requestFrame).not.toHaveBeenCalled()
    coordinator.flushNow()

    expect(apply).toHaveBeenCalledWith(next)
    expect(owner.getAppliedSnapshot()).toBe(next)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('retries a transient render mutation once before publishing the applied snapshot', () => {
    const frames: FrameRequestCallback[] = []
    const owner = createTerminalAppearanceOwner(createValue(), { initiallyApplied: true })
    const initial = owner.getAppliedSnapshot()
    const apply = vi.fn().mockImplementationOnce(() => {
      throw new Error('render surface replaced')
    })
    const refresh = vi.fn()
    const coordinator = createTerminalAppearanceRefreshCoordinator({
      owner,
      apply,
      refresh,
      requestFrame: callback => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })
    const next = owner.update(createValue({ themeId: 'ember' }))

    coordinator.request(next)
    frames.shift()?.(performance.now())

    expect(owner.getAppliedSnapshot()).toBe(initial)
    expect(frames).toHaveLength(1)

    frames.shift()?.(performance.now())

    expect(apply).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(owner.getAppliedSnapshot()).toBe(next)
  })
})
