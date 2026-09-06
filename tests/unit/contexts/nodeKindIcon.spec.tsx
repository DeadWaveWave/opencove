import React from 'react'
import { readFileSync } from 'node:fs'
import { fireEvent, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { NodeKindIcon } from '../../../src/contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'
import { ImageNode } from '../../../src/contexts/workspace/presentation/renderer/components/ImageNode'

describe('node kind decoration', () => {
  it('keeps each shared icon decorative and leaves header pointer handling with its owner', () => {
    const onPointerDown = vi.fn()
    const { container } = render(
      <div data-node-drag-handle="true" onPointerDown={onPointerDown}>
        {(
          ['terminal', 'agent', 'note', 'document', 'task', 'role', 'website', 'image'] as const
        ).map(kind => (
          <NodeKindIcon key={kind} kind={kind} />
        ))}
      </div>,
    )
    const icons = container.querySelectorAll('svg')
    expect(icons).toHaveLength(8)
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('focusable', 'false')
      expect(icon).not.toHaveAttribute('tabindex')
      expect(icon.closest('button, .nodrag')).toBeNull()
      fireEvent.pointerDown(icon)
    }
    expect(onPointerDown).toHaveBeenCalledTimes(8)
    expect(container.querySelector('[data-cove-node-kind-icon="agent"]')).toHaveClass('lucide-bot')
    expect(container.querySelector('[data-cove-node-kind-icon="role"]')).toHaveClass(
      'lucide-contact-round',
    )
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
