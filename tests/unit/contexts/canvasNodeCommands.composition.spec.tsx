import React from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useComposedCanvasNodeCommands } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeCommands'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'

// S7 of #647: the composition of the families from the functions that implement them.

describe('the composition of the families (useComposedCanvasNodeCommands)', () => {
  function implementations() {
    return {
      selectNode: vi.fn(),
      clearNodeSelection: vi.fn(),
      requestNodeClose: vi.fn(async () => undefined),
      requestNodeDelete: vi.fn(),
      resizeNode: vi.fn(),
      setNodeLabelColorOverride: vi.fn(),
      updateScrollback: vi.fn(),
      recordCommandRun: vi.fn(),
      clearAgentOverlay: vi.fn(),
      renameTerminalTitle: vi.fn(),
      copyLastAgentMessage: vi.fn(async () => undefined),
      reloadAgentSession: vi.fn(async () => undefined),
      listAgentSessions: vi.fn(async () => []),
      switchAgentSession: vi.fn(async () => undefined),
      updateNoteText: vi.fn(),
      renameNoteTitle: vi.fn(),
      convertNoteToTask: vi.fn(() => false),
      updateWebsiteUrl: vi.fn(),
      setWebsitePinned: vi.fn(),
      setWebsiteSession: vi.fn(),
      setWebsiteMode: vi.fn(),
      setWebsiteFullscreen: vi.fn(),
      updateRoleInput: vi.fn(),
      updateRoleProvider: vi.fn(),
      runRole: vi.fn(async () => undefined),
    }
  }

  function renderCommands() {
    const base = implementations()
    const instance = { setCenter: vi.fn() } as never
    const readSettings = () => DEFAULT_AGENT_SETTINGS
    return {
      base,
      ...renderHook(
        (props: ReturnType<typeof implementations>) =>
          useComposedCanvasNodeCommands({
            reactFlow: instance,
            readAgentSettings: readSettings,
            ...props,
          }),
        {
          initialProps: base,
          wrapper: ({ children }) => <CanvasStoreTestProvider>{children}</CanvasStoreTestProvider>,
        },
      ),
    }
  }

  it('returns the same object, and the same families, for the same functions', () => {
    const { result, rerender, base } = renderCommands()
    const first = result.current

    rerender({ ...base })

    expect(result.current).toBe(first)
    expect(result.current.window).toBe(first.window)
    expect(result.current.terminal).toBe(first.terminal)
    expect(result.current.note).toBe(first.note)
    expect(result.current.website).toBe(first.website)
    expect(result.current.role).toBe(first.role)
  })

  it.each([
    ['selectNode', 'window'],
    ['clearNodeSelection', 'window'],
    ['requestNodeClose', 'window'],
    ['requestNodeDelete', 'window'],
    ['resizeNode', 'window'],
    ['setNodeLabelColorOverride', 'window'],
    ['updateScrollback', 'terminal'],
    ['recordCommandRun', 'terminal'],
    ['clearAgentOverlay', 'terminal'],
    ['renameTerminalTitle', 'terminal'],
    ['copyLastAgentMessage', 'terminal'],
    ['reloadAgentSession', 'terminal'],
    ['listAgentSessions', 'terminal'],
    ['switchAgentSession', 'terminal'],
    ['updateNoteText', 'note'],
    ['renameNoteTitle', 'note'],
    ['convertNoteToTask', 'note'],
    ['updateWebsiteUrl', 'website'],
    ['setWebsitePinned', 'website'],
    ['setWebsiteSession', 'website'],
    ['setWebsiteMode', 'website'],
    ['setWebsiteFullscreen', 'website'],
    ['updateRoleInput', 'role'],
    ['updateRoleProvider', 'role'],
    ['runRole', 'role'],
  ] as const)('renews %s: its family and the object, and no other family', (name, family) => {
    const { result, rerender, base } = renderCommands()
    const first = result.current

    rerender({ ...base, [name]: vi.fn() })

    expect(result.current).not.toBe(first)
    for (const other of ['window', 'terminal', 'note', 'website', 'role'] as const) {
      if (other === family) {
        expect(result.current[other], other).not.toBe(first[other])
      } else {
        expect(result.current[other], other).toBe(first[other])
      }
    }
  })

  it('binds each command to the function it is named for', async () => {
    const { result, base } = renderCommands()
    const commands = result.current

    commands.window.select('x', { toggle: true })
    commands.window.clearSelection()
    await commands.window.close('x')
    commands.window.requestDelete(['x'])
    commands.note.updateText('x', 't')
    commands.website.setPinned('x', true)
    commands.role.updateInput('x', 'in')
    commands.role.updateProvider('x', 'opencode')
    await commands.role.run('x', 'override')
    commands.terminal.updateScrollback('x', 'out')
    commands.terminal.recordCommandRun('x', 'ls', 7)
    commands.terminal.clearAgentOverlay('x', 8)
    commands.terminal.renameTitle('x', 'name')
    await commands.terminal.copyLastAgentMessage('x')
    await commands.terminal.reloadAgentSession('x')
    await commands.terminal.listAgentSessions('x', 3)
    await commands.terminal.switchAgentSession('x', { sessionId: 's' } as never)

    expect(base.selectNode).toHaveBeenCalledWith('x', { toggle: true })
    expect(base.clearNodeSelection).toHaveBeenCalledTimes(1)
    expect(base.requestNodeClose).toHaveBeenCalledWith('x')
    expect(base.requestNodeDelete).toHaveBeenCalledWith(['x'])
    expect(base.updateNoteText).toHaveBeenCalledWith('x', 't')
    expect(base.setWebsitePinned).toHaveBeenCalledWith('x', true)
    expect(base.updateRoleInput).toHaveBeenCalledWith('x', 'in')
    expect(base.updateRoleProvider).toHaveBeenCalledWith('x', 'opencode')
    expect(base.runRole).toHaveBeenCalledWith('x', 'override')
    expect(base.updateScrollback).toHaveBeenCalledWith('x', 'out')
    expect(base.recordCommandRun).toHaveBeenCalledWith('x', 'ls', 7)
    expect(base.clearAgentOverlay).toHaveBeenCalledWith('x', 8)
    expect(base.renameTerminalTitle).toHaveBeenCalledWith('x', 'name')
    expect(base.copyLastAgentMessage).toHaveBeenCalledWith('x')
    expect(base.reloadAgentSession).toHaveBeenCalledWith('x')
    expect(base.listAgentSessions).toHaveBeenCalledWith('x', 3)
    expect(base.switchAgentSession).toHaveBeenCalledWith('x', { sessionId: 's' })
  })
})
