import { describe, expect, it } from 'vitest'
import {
  normalizeKeybindingOverrides,
  resolveCommandKeybinding,
  resolveDefaultKeybindings,
} from '../../../src/contexts/settings/domain/keybindings'

describe('settings keybindings', () => {
  it('uses a single default shortcut for command center and workspace canvas commands', () => {
    const bindings = resolveDefaultKeybindings('darwin')

    expect(bindings['commandCenter.toggle']).toMatchObject({
      code: 'KeyP',
      metaKey: true,
      shiftKey: false,
    })
    expect(bindings['workspaceCanvas.cycleSpacesForward']).toMatchObject({
      code: 'BracketRight',
      metaKey: true,
      shiftKey: false,
    })
    expect(bindings['workspaceCanvas.cycleSpacesBackward']).toMatchObject({
      code: 'BracketLeft',
      metaKey: true,
      shiftKey: false,
    })
    expect(bindings['workspaceCanvas.cycleIdleSpacesForward']).toMatchObject({
      code: 'BracketRight',
      metaKey: true,
      shiftKey: true,
    })
    expect(bindings['workspaceCanvas.cycleIdleSpacesBackward']).toMatchObject({
      code: 'BracketLeft',
      metaKey: true,
      shiftKey: true,
    })
  })

  it('allows overriding a command to be unassigned', () => {
    expect(
      resolveCommandKeybinding({
        commandId: 'commandCenter.toggle',
        overrides: {
          'commandCenter.toggle': null,
        },
        platform: 'darwin',
      }),
    ).toBeNull()
  })

  it('does not read legacy primary/secondary keybinding shape', () => {
    expect(
      normalizeKeybindingOverrides({
        'commandCenter.toggle': {
          primary: {
            code: 'KeyK',
            altKey: false,
            ctrlKey: false,
            metaKey: true,
            shiftKey: false,
          },
        },
      }),
    ).toEqual({})
  })
})
