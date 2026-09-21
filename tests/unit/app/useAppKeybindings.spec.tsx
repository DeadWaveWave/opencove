import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAppKeybindings } from '../../../src/app/renderer/shell/hooks/useAppKeybindings'

function renderAppKeybindings(options?: {
  workspaceIds?: readonly string[]
  onSelectWorkspace?: (workspaceId: string) => void
}) {
  return renderHook(() =>
    useAppKeybindings({
      enabled: true,
      settings: {
        disableAppShortcutsWhenTerminalFocused: false,
        keybindings: {},
      },
      onToggleCommandCenter: vi.fn(),
      onOpenSettings: vi.fn(),
      onTogglePrimarySidebar: vi.fn(),
      onAddProject: vi.fn(),
      onOpenWorkspaceSearch: vi.fn(),
      workspaceIds: options?.workspaceIds ?? ['project-a', 'project-b', 'project-c'],
      onSelectWorkspace: options?.onSelectWorkspace ?? vi.fn(),
    }),
  )
}

describe('useAppKeybindings project shortcuts', () => {
  it('switches to projects in sidebar order with Cmd/Ctrl plus a number', () => {
    const onSelectWorkspace = vi.fn()
    renderAppKeybindings({ onSelectWorkspace })

    fireEvent.keyDown(document.body, { code: 'Digit2', key: '2', metaKey: true })
    fireEvent.keyDown(document.body, { code: 'Digit3', key: '#', ctrlKey: true })

    expect(onSelectWorkspace).toHaveBeenNthCalledWith(1, 'project-b')
    expect(onSelectWorkspace).toHaveBeenNthCalledWith(2, 'project-c')
  })

  it('ignores project shortcuts while editing text', () => {
    const onSelectWorkspace = vi.fn()
    renderAppKeybindings({ onSelectWorkspace })

    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    fireEvent.keyDown(input, { code: 'Digit1', key: '1', metaKey: true })

    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    document.body.append(editor)
    editor.focus()
    fireEvent.keyDown(editor, { code: 'Digit1', key: '1', ctrlKey: true })

    expect(onSelectWorkspace).not.toHaveBeenCalled()
    input.remove()
    editor.remove()
  })

  it('does not handle unavailable projects or shifted number keys', () => {
    const onSelectWorkspace = vi.fn()
    renderAppKeybindings({ workspaceIds: ['project-a'], onSelectWorkspace })

    fireEvent.keyDown(document.body, { code: 'Digit2', key: '@', metaKey: true })
    fireEvent.keyDown(document.body, { code: 'Digit1', key: '!', metaKey: true, shiftKey: true })

    expect(onSelectWorkspace).not.toHaveBeenCalled()
  })
})
