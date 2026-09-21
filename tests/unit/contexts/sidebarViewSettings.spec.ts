import { describe, expect, it } from 'vitest'
import { normalizeAgentSettings } from '../../../src/contexts/settings/domain/agentSettings'
import {
  DEFAULT_SIDEBAR_VIEW_SETTINGS,
  normalizeSidebarViewSettings,
  setSidebarItemHidden,
} from '../../../src/contexts/settings/domain/sidebarViewSettings'

describe('Sidebar visibility preferences', () => {
  it.each([undefined, null, {}, [], { filters: 1 }])(
    'defaults old or malformed preferences safely: %j',
    value => {
      expect(normalizeSidebarViewSettings(value)).toEqual(DEFAULT_SIDEBAR_VIEW_SETTINGS)
      expect(normalizeAgentSettings({ sidebarView: value }).sidebarView).toEqual(
        DEFAULT_SIDEBAR_VIEW_SETTINGS,
      )
    },
  )

  it('round trips scoped visibility and compact mode through AgentSettings persistence', () => {
    const sidebarView = normalizeSidebarViewSettings({
      hiddenSpaceIds: { 'project-a:space': true, invalid: 1, '': true },
      hiddenAgentIds: { 'project-b:agent': true, invalid: 'true' },
      filters: { status: 'waiting', provider: 'codex', visibility: 'hidden' },
    })
    expect(sidebarView).toEqual({
      hiddenSpaceIds: { 'project-a:space': true },
      hiddenAgentIds: { 'project-b:agent': true },
      pinnedAgentIds: {},
      mode: 'normal',
      filters: { status: 'waiting', provider: 'codex', visibility: 'hidden' },
    })
    expect(normalizeAgentSettings(JSON.parse(JSON.stringify({ sidebarView }))).sidebarView).toEqual(
      sidebarView,
    )
  })

  it('restores a parent without clearing its children or another project’s hidden preferences', () => {
    let view = setSidebarItemHidden(DEFAULT_SIDEBAR_VIEW_SETTINGS, 'space', 'a', 'space', true)
    view = setSidebarItemHidden(view, 'agent', 'a', 'agent', true)
    view = setSidebarItemHidden(view, 'space', 'b', 'space', true)
    const restored = setSidebarItemHidden(view, 'space', 'a', 'space', false)
    expect(restored.hiddenSpaceIds).toEqual({ 'b:space': true })
    expect(restored.hiddenAgentIds).toEqual({ 'a:agent': true })
    expect(setSidebarItemHidden(restored, 'space', 'a', 'space', false)).toBe(restored)
    expect(view.hiddenSpaceIds).toEqual({ 'a:space': true, 'b:space': true })
  })
})
