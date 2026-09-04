import { describe, expect, it } from 'vitest'
import { retainTerminalLiveReattachScope } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalLiveReattachScope'

describe('terminal live reattach scope', () => {
  it('does not let a later sync projection reclassify the current live session', () => {
    const current = {
      sessionId: 'session-live',
      isLiveSessionReattach: true,
    }

    expect(
      retainTerminalLiveReattachScope(current, {
        sessionId: 'session-live',
        isLiveSessionReattach: false,
      }),
    ).toBe(current)
  })

  it('captures reattach classification again for a replacement session', () => {
    expect(
      retainTerminalLiveReattachScope(
        { sessionId: 'session-old', isLiveSessionReattach: true },
        { sessionId: 'session-new', isLiveSessionReattach: false },
      ),
    ).toEqual({ sessionId: 'session-new', isLiveSessionReattach: false })
  })
})
