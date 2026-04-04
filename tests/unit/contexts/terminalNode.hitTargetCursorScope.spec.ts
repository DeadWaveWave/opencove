import { describe, expect, it } from 'vitest'
import { resolveTerminalHitTargetCursor } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hitTargetCursorScope'

function createClassList(classes: string[]): Pick<DOMTokenList, 'contains'> {
  const classSet = new Set(classes)
  return {
    contains: token => classSet.has(token),
  }
}

describe('terminal hit target cursor scope', () => {
  it('defaults to text when xterm is in text input mode', () => {
    expect(resolveTerminalHitTargetCursor(createClassList([]))).toBe('text')
  })

  it('uses default when xterm mouse events are enabled', () => {
    expect(resolveTerminalHitTargetCursor(createClassList(['enable-mouse-events']))).toBe('default')
  })

  it('prefers pointer when xterm exposes pointer cursor state', () => {
    expect(resolveTerminalHitTargetCursor(createClassList(['xterm-cursor-pointer']))).toBe(
      'pointer',
    )
  })
})
