import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { applyUiLanguage } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { CommandCenter } from './CommandCenter'

vi.mock('../hooks/useWorkspaceMountSummaries', () => ({
  useWorkspaceMountDetails: () => ({
    remote: {
      summary: 'source Development',
      remote: { endpointId: 'dev', displayName: 'Development', rootPath: '/srv/code' },
    },
  }),
}))

function project(id: string): WorkspaceState {
  return {
    id,
    name: id === 'local' ? 'OpenCove' : 'Remote project',
    iconId: 'code',
    path: `/tmp/${id}/private-project`,
    worktreesRoot: '',
    nodes: [],
    spaces: [
      {
        id: 'ui',
        name: 'ui/chrome',
        labelColor: 'blue',
        directoryPath: '/tmp/local',
        targetMountId: null,
        nodeIds: [],
        rect: { x: 0, y: 0, width: 500, height: 400 },
      },
    ],
    activeSpaceId: 'ui',
    spaceArchiveRecords: [],
    viewport: { x: 10, y: 20, zoom: 0.5 },
    isMinimapVisible: false,
  }
}

const workspaces = [project('local'), project('remote')]
const actions = {
  onSelectWorkspace: vi.fn(),
  onSelectSpace: vi.fn(),
  onOpenWorkspaceSearch: vi.fn(),
  onOpenSpaceArchives: vi.fn(),
  onTogglePrimarySidebar: vi.fn(),
  onAddWorkspace: vi.fn(),
}

function Harness() {
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <div className="app-shell" data-testid="app-shell">
        <button data-testid="app-header-command-center" onClick={() => setOpen(true)}>
          Open commands
        </button>
        <textarea aria-label="Terminal input" onKeyDown={() => setOpen(true)} />
      </div>
      <CommandCenter
        {...actions}
        isOpen={open}
        activeWorkspace={workspaces[0]}
        workspaces={workspaces}
        isPrimarySidebarCollapsed={false}
        onClose={() => setOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Dialog
        open={settingsOpen}
        aria-label="Settings"
        initialFocusRef={settingsRef}
        onDismiss={() => setSettingsOpen(false)}
      >
        <input ref={settingsRef} aria-label="Search settings" />
      </Dialog>
    </>
  )
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  act(() => window.dispatchEvent(new Event('resize')))
}

function openCommands() {
  const trigger = screen.getByTestId('app-header-command-center')
  trigger.focus()
  fireEvent.click(trigger)
  act(() => vi.runOnlyPendingTimers())
  return screen.getByRole('combobox')
}

describe('Command Center interaction', () => {
  const originalWidth = window.innerWidth
  beforeEach(async () => {
    await applyUiLanguage('en')
    vi.useFakeTimers()
    vi.clearAllMocks()
    setViewportWidth(1200)
  })
  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    setViewportWidth(originalWidth)
  })

  it('keeps input focus while arrows select results and Tab stays within the dialog', () => {
    render(<Harness />)
    const input = openCommands()
    const first = screen.getByTestId('command-center-item-command:workspace-search')
    const second = screen.getByTestId('command-center-item-command:settings')
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(second.id)
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    const close = screen.getByTestId('command-center-close')
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryByTestId('command-center')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('app-header-command-center'))
    expect(screen.getByTestId('app-shell').inert).toBe(false)
  })

  it('does not execute IME Enter or a stale selection after the query has no matches', () => {
    render(<Harness />)
    const input = openCommands()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(actions.onOpenWorkspaceSearch).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'no-matches-at-all-12345' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('command-center')).toBeTruthy()
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    expect(actions.onOpenWorkspaceSearch).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Remote project' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.onSelectWorkspace).toHaveBeenCalledWith('remote')
    expect(screen.queryByTestId('command-center')).toBeNull()
  })

  it('retains searchable paths without displaying them, along with project and Space identity', () => {
    render(<Harness />)
    const input = openCommands()
    const dialog = screen.getByTestId('command-center')
    const remote = screen.getByTestId('command-center-item-workspace:remote')
    const space = screen.getByTestId('command-center-item-space:ui')
    expect(dialog.textContent).not.toContain('/tmp/')
    expect(remote.querySelector('[data-cove-project-icon-id="code"]')).not.toBeNull()
    expect(remote.querySelector('[aria-label="Remote project: Development"]')).not.toBeNull()
    expect(space.getAttribute('data-cove-label-color')).toBe('blue')
    expect(space.getAttribute('aria-current')).toBe('location')
    expect(space.querySelector('.command-center__current')).toBeNull()
    fireEvent.change(input, { target: { value: '/tmp/remote' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option').textContent).toBe('Remote project')
  })

  it('offers current-project search as a clickable command', () => {
    render(<Harness />)
    openCommands()
    fireEvent.click(screen.getByTestId('command-center-item-command:workspace-search'))
    expect(actions.onOpenWorkspaceSearch).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('command-center')).toBeNull()
  })

  it.each([390, 1200])('hands focus to settings without delayed restoration at %i px', width => {
    setViewportWidth(width)
    render(<Harness />)
    openCommands()
    fireEvent.click(screen.getByTestId('command-center-item-command:settings'))
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search settings' }))
  })

  it('does not open a mobile keyboard and returns to navigation instead of terminal input', () => {
    setViewportWidth(390)
    render(<Harness />)
    const terminal = screen.getByRole('textbox', { name: 'Terminal input' })
    terminal.focus()
    fireEvent.keyDown(terminal, { key: 'p', metaKey: true })
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(screen.getByTestId('command-center-close'))
    fireEvent.click(screen.getByTestId('command-center-close'))
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(screen.getByTestId('app-header-command-center'))
  })
})
