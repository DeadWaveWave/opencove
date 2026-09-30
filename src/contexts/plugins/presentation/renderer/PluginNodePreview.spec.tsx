import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as registry from './usePluginRegistry'
import { PluginNodePreview } from './PluginNodePreview'
import { examplePlugin } from './pluginPresentationTestFixture'

vi.mock('./PluginRuntimePreview', () => ({
  PluginRuntimePreview: () => <div data-testid="declared-preview" />,
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PluginNodePreview declarations', () => {
  it('uses the common preview for any installed plugin that declares one', () => {
    vi.spyOn(registry, 'usePluginManifest').mockReturnValue(examplePlugin)
    render(<PluginNodePreview pluginId={examplePlugin.id} />)
    expect(screen.getByTestId('declared-preview')).toBeVisible()
  })
  it.each([null, { ...examplePlugin, hasPreview: false }])(
    'never starts a runtime as a fallback for an unavailable preview',
    plugin => {
      const invoke = vi.fn()
      vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
      vi.spyOn(registry, 'usePluginManifest').mockReturnValue(plugin)
      render(<PluginNodePreview pluginId="unknown" />)
      expect(screen.queryByTestId('declared-preview')).toBeNull()
      expect(invoke).not.toHaveBeenCalled()
    },
  )
})
