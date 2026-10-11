import { describe, expect, it } from 'vitest'
import { resolveLinkGesture } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/linkGesture'

const click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  detail: 1,
}
describe('terminal link gesture ownership', () => {
  it('preserves macOS control-click and uses platform navigation modifiers', () => {
    expect(resolveLinkGesture({ ...click, ctrlKey: true }, true, false)).toBeNull()
    expect(resolveLinkGesture({ ...click, metaKey: true }, true, false)).toBe('open')
    expect(resolveLinkGesture({ ...click, ctrlKey: true }, false, false)).toBe('open')
    expect(resolveLinkGesture({ ...click, metaKey: true }, false, false)).toBeNull()
  })
  it('allows Shift with the platform navigation modifier while preserving Shift selection', () => {
    for (const mouseTracking of [false, true]) {
      expect(
        resolveLinkGesture({ ...click, shiftKey: true, metaKey: true }, true, mouseTracking),
      ).toBe('open')
      expect(
        resolveLinkGesture({ ...click, shiftKey: true, ctrlKey: true }, false, mouseTracking),
      ).toBe('open')
      expect(resolveLinkGesture({ ...click, shiftKey: true }, true, mouseTracking)).toBeNull()
      expect(resolveLinkGesture({ ...click, shiftKey: true }, false, mouseTracking)).toBeNull()
      expect(
        resolveLinkGesture({ ...click, shiftKey: true, ctrlKey: true }, true, mouseTracking),
      ).toBeNull()
      expect(
        resolveLinkGesture({ ...click, shiftKey: true, metaKey: true }, false, mouseTracking),
      ).toBeNull()
    }
  })
  it('does not consume TUI clicks, selection modifiers, double clicks or auxiliary buttons', () => {
    expect(resolveLinkGesture(click, false, true)).toBeNull()
    expect(resolveLinkGesture({ ...click, ctrlKey: true }, false, true)).toBe('open')
    for (const event of [
      { ...click, shiftKey: true },
      { ...click, altKey: true },
      { ...click, detail: 2 },
      { ...click, button: 1 },
    ]) {
      expect(resolveLinkGesture(event, false, false)).toBeNull()
    }
    expect(resolveLinkGesture(click, false, false)).toBe('menu')
  })
})
