import React from 'react'
import { readFileSync } from 'node:fs'
import { fireEvent, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../../../src/contexts/settings/domain/agentSettings'
import { NodeKindIcon } from '../../../src/contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'
import { ImageNode } from '../../../src/contexts/workspace/presentation/renderer/components/ImageNode'

describe('node kind decoration', () => {
  it('keeps each shared icon decorative and leaves header pointer handling with its owner', () => {
    const onPointerDown = vi.fn()
    const { container } = render(
      <div data-node-drag-handle="true" onPointerDown={onPointerDown}>
        {(
          [
            'terminal',
            'agent',
            'note',
            'document',
            'folder',
            'task',
            'role',
            'website',
            'image',
          ] as const
        ).map(kind => (
          <NodeKindIcon key={kind} kind={kind} />
        ))}
      </div>,
    )
    const icons = container.querySelectorAll('svg')
    expect(icons).toHaveLength(9)
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('focusable', 'false')
      expect(icon).not.toHaveAttribute('tabindex')
      expect(icon.closest('button, .nodrag')).toBeNull()
      fireEvent.pointerDown(icon)
    }
    expect(onPointerDown).toHaveBeenCalledTimes(9)
    for (const icon of icons) {
      const kind = icon.getAttribute('data-cove-node-kind-icon')
      expect(icon).toHaveAttribute('data-cove-pixel-glyph', kind === 'agent' ? 'ai' : kind)
      expect(icon).toHaveAttribute('data-cove-kind', kind)
      expect(icon).toHaveClass('cove-node-kind-icon', 'cove-pixel-glyph')
    }
  })

  it('draws an agent with a known provider as its brand mark and other cases as pixel glyphs', () => {
    const { container } = render(
      <>
        <NodeKindIcon kind="agent" provider="kimi" />
        <NodeKindIcon kind="agent" provider={null} />
        <NodeKindIcon kind="agent" provider={'retired-cli' as AgentProvider} />
        <NodeKindIcon kind="terminal" provider="codex" />
      </>,
    )
    const [kimi, unknown, retired, terminal] = Array.from(container.querySelectorAll('svg'))
    expect(kimi).toHaveAttribute('data-agent-provider', 'kimi')
    expect(kimi).toHaveAttribute('data-cove-node-kind-icon', 'agent')
    expect(kimi).toHaveAttribute('data-cove-kind', 'agent')
    expect(kimi).toHaveAttribute('data-cove-part', 'icon')
    expect(container.querySelector('img')).toBeNull()
    expect(unknown).toHaveAttribute('data-cove-pixel-glyph', 'ai')
    expect(retired).toHaveAttribute('data-cove-pixel-glyph', 'ai')
    expect(retired).not.toHaveAttribute('data-agent-provider')
    expect(terminal).toHaveAttribute('data-cove-pixel-glyph', 'terminal')
    expect(terminal).not.toHaveAttribute('data-agent-provider')
  })

  it('takes the kind colour from kind tiles and far tiles', () => {
    const style = document.createElement('style')
    style.textContent = [
      'src/app/renderer/styles/ui-badges.css',
      'src/app/renderer/styles/node-kind-icon.css',
    ]
      .map(path => readFileSync(path, 'utf8'))
      .join('\n')
    document.head.append(style)
    try {
      const { container } = render(
        <div style={{ ['--cove-text-muted' as string]: 'rgb(9, 9, 9)' }}>
          <span className="cove-kind-tile" style={{ color: 'rgb(1, 2, 3)' }}>
            <NodeKindIcon kind="agent" provider="codex" />
          </span>
          <span className="workspace-far-tile__icon" style={{ color: 'rgb(4, 5, 6)' }}>
            <NodeKindIcon kind="note" />
          </span>
          <NodeKindIcon kind="task" />
        </div>,
      )
      // Happy DOM reports a cascaded `inherit` as written.
      const colour = (element: Element): string => {
        const value = getComputedStyle(element).color
        return value === 'inherit' ? getComputedStyle(element.parentElement!).color : value
      }
      const [brand, glyph, bare] = Array.from(container.querySelectorAll('.cove-node-kind-icon'))
      expect(colour(brand)).toBe('rgb(1, 2, 3)')
      expect(colour(glyph)).toBe('rgb(4, 5, 6)')
      expect(colour(bare)).toBe('rgb(9, 9, 9)')
    } finally {
      style.remove()
    }
  })

  it('does not turn the terminal kind icon into title editing or a close action', () => {
    const onClose = vi.fn()
    const onTitleCommit = vi.fn()
    const onHeaderPointerDownCapture = vi.fn()
    const { container, queryByTestId } = render(
      <TerminalNodeHeader
        title="Terminal"
        kind="terminal"
        status={null}
        onClose={onClose}
        onTitleCommit={onTitleCommit}
        onHeaderPointerDownCapture={onHeaderPointerDownCapture}
      />,
    )
    const icon = container.querySelector('[data-cove-node-kind-icon="terminal"]')!
    expect(icon.closest('[data-node-drag-handle="true"]')).not.toBeNull()
    fireEvent.pointerDown(icon)
    fireEvent.click(icon)
    expect(onHeaderPointerDownCapture).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    expect(onTitleCommit).not.toHaveBeenCalled()
    expect(queryByTestId('terminal-node-inline-title-input')).toBeNull()
  })

  it('adds an agent icon while keeping its full provider identity', () => {
    const { container, getByText } = render(
      <TerminalNodeHeader
        title="codex · linked task"
        fixedTitlePrefix="codex · "
        kind="agent"
        status="running"
        onTitleCommit={() => undefined}
        onClose={() => undefined}
      />,
    )
    expect(getByText('codex ·')).toBeInTheDocument()
    expect(container.querySelector('[data-cove-node-kind-icon="agent"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(container.querySelector('[data-cove-node-kind-icon="terminal"]')).toBeNull()
  })

  it('keeps image decoration out of layout and hit testing without adding a header', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync('src/app/renderer/styles/node-kind-icon.css', 'utf8')
    document.head.append(style)
    try {
      const { container } = render(
        <ReactFlowProvider>
          <ImageNode
            assetId="image-asset"
            mimeType="image/png"
            fileName="reference.png"
            naturalWidth={480}
            naturalHeight={320}
            position={{ x: 0, y: 0 }}
            width={480}
            height={320}
            onClose={() => undefined}
            onResize={() => undefined}
          />
        </ReactFlowProvider>,
      )
      const frame = container.querySelector<HTMLElement>('.image-node')!
      const badge = container.querySelector<HTMLElement>('.cove-node-kind-badge')!
      expect(frame.style.width).toBe('480px')
      expect(frame.style.height).toBe('320px')
      expect(frame.querySelector('[class$="__header"]')).toBeNull()
      expect(getComputedStyle(badge).position).toBe('absolute')
      expect(getComputedStyle(badge).pointerEvents).toBe('none')
      expect(getComputedStyle(badge.querySelector('svg')!).pointerEvents).toBe('none')
    } finally {
      style.remove()
    }
  })
})
