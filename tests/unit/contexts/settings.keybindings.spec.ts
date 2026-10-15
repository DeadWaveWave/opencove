import { describe, expect, it } from 'vitest'
import {
  describeKeyChord,
  normalizeKeybindingOverrides,
  resolveCommandKeybinding,
  resolveDefaultKeybindings,
  type KeyChord,
} from '../../../src/contexts/settings/domain/keybindings'

const keyChord = (code: string, modifiers: Partial<KeyChord> = {}): KeyChord => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
})

describe('settings keybindings', () => {
  it('uses a single default shortcut for command center and workspace canvas commands', () => {
    const bindings = resolveDefaultKeybindings('darwin')

    expect(bindings['commandCenter.toggle']).toMatchObject({
      code: 'KeyP',
      metaKey: true,
      shiftKey: false,
    })
    expect(bindings['workspaceCanvas.createAgent']).toEqual({
      code: 'KeyA',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
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
    expect(bindings['workspaceCanvas.navigateNodeRight']).toMatchObject({
      code: 'ArrowRight',
      altKey: true,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
    })
    expect(bindings['workspaceCanvas.navigateSpaceRight']).toMatchObject({
      code: 'ArrowRight',
      altKey: true,
      metaKey: true,
      ctrlKey: false,
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

  it('preserves an existing explicit assignment when adding the default Agent shortcut', () => {
    const chord = resolveDefaultKeybindings('darwin')['workspaceCanvas.createAgent']
    expect(
      resolveCommandKeybinding({
        commandId: 'workspaceCanvas.createAgent',
        overrides: { 'commandCenter.toggle': chord },
        platform: 'darwin',
      }),
    ).toBeNull()
    expect(
      resolveCommandKeybinding({
        commandId: 'commandCenter.toggle',
        overrides: { 'commandCenter.toggle': chord },
        platform: 'darwin',
      }),
    ).toEqual(chord)
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

  it('describes a chord as menus show it and as aria-keyshortcuts names it', () => {
    expect(describeKeyChord('darwin', keyChord('KeyT', { metaKey: true }))).toEqual({
      label: '⌘T',
      ariaKeyShortcuts: 'Meta+T',
    })
    expect(
      describeKeyChord('win32', keyChord('BracketRight', { ctrlKey: true, shiftKey: true })),
    ).toEqual({ label: 'Ctrl Shift ]', ariaKeyShortcuts: 'Control+Shift+]' })
    expect(
      describeKeyChord('linux', keyChord('ArrowLeft', { ctrlKey: true, altKey: true })),
    ).toEqual({ label: 'Ctrl Alt ←', ariaKeyShortcuts: 'Control+Alt+ArrowLeft' })
    expect(describeKeyChord('darwin', keyChord('Space', { ctrlKey: true }))?.ariaKeyShortcuts).toBe(
      'Control+Space',
    )
    expect(describeKeyChord('darwin', keyChord('Escape'))?.ariaKeyShortcuts).toBe('Escape')
    expect(
      describeKeyChord('darwin', keyChord('Digit1', { metaKey: true }))?.ariaKeyShortcuts,
    ).toBe('Meta+1')
    expect(describeKeyChord('darwin', keyChord('Backslash', { metaKey: true }))).toEqual({
      label: '⌘\\',
      ariaKeyShortcuts: 'Meta+\\',
    })
    expect(describeKeyChord('darwin', null)).toBeNull()
  })
})
