import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuState, SpaceActionMenuState } from '../components/workspaceCanvas/types'
import { createCanvasStore } from './canvasStore'

const paneMenu: ContextMenuState = { kind: 'pane', x: 10, y: 20, flowX: 1, flowY: 2 }
const selectionMenu: ContextMenuState = { kind: 'selection', x: 30, y: 40, nodeId: 'node-1' }
const spaceMenu: SpaceActionMenuState = { spaceId: 'space-1', x: 50, y: 60 }

describe('canvas store', () => {
  it('starts with both menus closed', () => {
    const { api } = createCanvasStore()

    expect(api.getState().ui).toEqual({ contextMenu: null, spaceActionMenu: null })
    expect(api.getInitialState().ui).toEqual({ contextMenu: null, spaceActionMenu: null })
  })

  it('notifies once per changing command', () => {
    const { api, commands } = createCanvasStore()
    const listener = vi.fn()
    api.subscribe(listener)

    commands.ui.openContextMenu(paneMenu)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(api.getState().ui.contextMenu).toBe(paneMenu)

    commands.ui.openContextMenu(selectionMenu)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(api.getState().ui.contextMenu).toBe(selectionMenu)

    commands.ui.closeContextMenu()
    expect(listener).toHaveBeenCalledTimes(3)
    expect(api.getState().ui.contextMenu).toBeNull()

    commands.ui.openSpaceActionMenu(spaceMenu)
    expect(listener).toHaveBeenCalledTimes(4)
    expect(api.getState().ui.spaceActionMenu).toBe(spaceMenu)

    commands.ui.closeSpaceActionMenu()
    expect(listener).toHaveBeenCalledTimes(5)
    expect(api.getState().ui.spaceActionMenu).toBeNull()
  })

  it('notifies nobody when a command changes nothing', () => {
    const { api, commands } = createCanvasStore()
    const listener = vi.fn()
    api.subscribe(listener)

    commands.ui.closeContextMenu()
    commands.ui.closeSpaceActionMenu()
    commands.ui.closeMenus()

    expect(listener).not.toHaveBeenCalled()
  })

  it('never has both menus open: each opener clears the other in the same update', () => {
    const { api, commands } = createCanvasStore()
    const seen: Array<{ contextMenu: unknown; spaceActionMenu: unknown }> = []
    api.subscribe(state => {
      seen.push({
        contextMenu: state.ui.contextMenu,
        spaceActionMenu: state.ui.spaceActionMenu,
      })
    })

    commands.ui.openSpaceActionMenu(spaceMenu)
    commands.ui.openContextMenu(paneMenu)
    commands.ui.openSpaceActionMenu(spaceMenu)

    expect(seen).toEqual([
      { contextMenu: null, spaceActionMenu: spaceMenu },
      { contextMenu: paneMenu, spaceActionMenu: null },
      { contextMenu: null, spaceActionMenu: spaceMenu },
    ])
  })

  it('closeMenus closes both menus in one notification', () => {
    const { api, commands } = createCanvasStore()
    commands.ui.openContextMenu(paneMenu)
    const listener = vi.fn()
    api.subscribe(listener)

    commands.ui.closeMenus()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(api.getState().ui).toEqual({ contextMenu: null, spaceActionMenu: null })

    commands.ui.openSpaceActionMenu(spaceMenu)
    commands.ui.closeMenus()
    expect(api.getState().ui).toEqual({ contextMenu: null, spaceActionMenu: null })
  })

  it('keeps command and api identity stable across state changes', () => {
    const store = createCanvasStore()
    const { api, commands } = store
    const openContextMenu = commands.ui.openContextMenu
    const closeMenus = commands.ui.closeMenus
    const stateBefore = api.getState()

    commands.ui.openContextMenu(paneMenu)
    commands.ui.openSpaceActionMenu(spaceMenu)
    commands.ui.closeMenus()

    expect(api.getState()).not.toBe(stateBefore)
    expect(store.api).toBe(api)
    expect(store.commands).toBe(commands)
    expect(store.commands.ui.openContextMenu).toBe(openContextMenu)
    expect(store.commands.ui.closeMenus).toBe(closeMenus)
    expect(api.getInitialState()).toBe(stateBefore)
  })

  it('gives each store its own state', () => {
    const first = createCanvasStore()
    const second = createCanvasStore()

    first.commands.ui.openContextMenu(paneMenu)

    expect(second.api.getState().ui.contextMenu).toBeNull()
  })

  it('exposes no raw setState, in its type or at runtime', () => {
    const store = createCanvasStore()

    expect('setState' in store.api).toBe(false)
    // @ts-expect-error -- the canvas store exposes no raw setState; write through its commands (#647 S3)
    expect(() => store.api.setState({})).toThrow(TypeError)
  })
})
