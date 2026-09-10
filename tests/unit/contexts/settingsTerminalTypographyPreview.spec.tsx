import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TerminalTypographyPreview } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/TerminalTypographyPreview'

describe('terminal typography preview', () => {
  it('updates the sample typography without replacing the window or scaling its header', () => {
    const { rerender } = render(<TerminalTypographyPreview fontFamily={null} fontSize={14} />)
    const preview = screen.getByRole('img')
    const content = screen.getByTestId('settings-terminal-typography-content')
    const header = preview.querySelector('.settings-terminal-preview__header')
    expect(preview).toHaveAccessibleName(/\S/)
    expect(header?.querySelector('svg.lucide-terminal')).not.toBeNull()
    expect(header?.querySelector('svg.lucide-square-terminal')).toBeNull()
    expect(content.style.fontFamily).toBe('var(--cove-font-mono)')
    expect(content.style.fontSize).toBe('14px')
    expect(content).toHaveTextContent('pnpm dev')

    rerender(<TerminalTypographyPreview fontFamily='"JetBrains Mono", monospace' fontSize={22} />)
    expect(screen.getByRole('img')).toBe(preview)
    expect(content.style.fontFamily).toBe('"JetBrains Mono", monospace')
    expect(content.style.fontSize).toBe('22px')
    expect(header).not.toHaveAttribute('style')
    expect(preview.querySelector('input, textarea, button, canvas, .xterm')).toBeNull()
  })
})
