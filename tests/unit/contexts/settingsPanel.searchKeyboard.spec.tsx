import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanelSidebar } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/SettingsPanelSidebar'
import type { SettingsSearchResult } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/settingsSearchIndex'

const searchHarness = vi.hoisted(() => ({
  currentResults: [] as SettingsSearchResult[],
}))

vi.mock(
  '../../../src/contexts/settings/presentation/renderer/settingsPanel/settingsSearchIndex',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../src/contexts/settings/presentation/renderer/settingsPanel/settingsSearchIndex')
      >()

    return {
      ...actual,
      searchSettingsEntries: vi.fn(() => searchHarness.currentResults),
    }
  },
)

function createSearchResult(id: string): SettingsSearchResult {
  return {
    id,
    pageId: 'general',
    pageLabel: 'General',
    title: `Setting ${id}`,
    anchorId: `anchor-${id}`,
    keywords: [],
    score: 100,
  }
}

function createSidebarProps(endpointsEnabled = false) {
  return {
    activePageId: 'general' as const,
    workspaces: [],
    endpointsEnabled,
    onSelectPage: vi.fn(),
    onSelectSearchResult: vi.fn(),
  }
}

describe('SettingsPanelSidebar search keyboard navigation', () => {
  let originalScrollIntoView: PropertyDescriptor | undefined
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    searchHarness.currentResults = []
    scrollIntoView.mockClear()
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
  })

  it('scrolls the active option into view while navigating all eight visible results', () => {
    searchHarness.currentResults = Array.from({ length: 8 }, (_, index) =>
      createSearchResult(`result-${index + 1}`),
    )
    render(<SettingsPanelSidebar {...createSidebarProps()} />)

    const search = screen.getByRole('searchbox', { name: 'Search settings' })
    fireEvent.change(search, { target: { value: 'setting' } })
    for (let index = 0; index < 8; index += 1) {
      fireEvent.keyDown(search, { key: 'ArrowDown', code: 'ArrowDown' })
    }

    expect(screen.getByTestId('settings-panel-search-result-result-8')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(8)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
  })

  it('keeps the active result valid when a rerender shortens and reorders the results', () => {
    const initialResults = Array.from({ length: 8 }, (_, index) =>
      createSearchResult(`result-${index + 1}`),
    )
    const retainedResult = initialResults[7]
    const props = createSidebarProps()
    searchHarness.currentResults = initialResults
    const { rerender } = render(<SettingsPanelSidebar {...props} />)

    const search = screen.getByRole('searchbox', { name: 'Search settings' })
    fireEvent.change(search, { target: { value: 'setting' } })
    for (let index = 0; index < 8; index += 1) {
      fireEvent.keyDown(search, { key: 'ArrowDown', code: 'ArrowDown' })
    }

    searchHarness.currentResults = [retainedResult, createSearchResult('result-new')]
    rerender(<SettingsPanelSidebar {...props} endpointsEnabled />)

    expect(search).toHaveAttribute('aria-activedescendant', 'settings-panel-search-result-result-8')
    expect(search.getAttribute('aria-activedescendant')).not.toContain('undefined')
    expect(() => {
      fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
    }).not.toThrow()
    expect(props.onSelectSearchResult).toHaveBeenCalledWith(retainedResult)
  })
})
