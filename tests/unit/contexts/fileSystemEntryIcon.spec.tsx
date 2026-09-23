import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  FileSystemEntryIcon,
  resolveFileSystemEntryIconKind,
} from '@contexts/workspace/presentation/renderer/components/shared/FileSystemEntryIcon'
import { NodeKindIcon } from '@contexts/workspace/presentation/renderer/components/shared/NodeKindIcon'

describe('filesystem entry identity', () => {
  it.each([
    ['/project/src/App.tsx', 'file-code-2'],
    ['C:\\project\\src\\APP.TSX', 'file-code-2'],
    ['file:///project/src/theme%2Ecss', 'file-code-2'],
    ['file://server/share/main.py', 'file-code-2'],
    ['/project/package.JSON', 'file-json'],
    ['/project/tsconfig.jsonc', 'file-json'],
    ['/project/docs/README.md', 'file-text'],
    ['/project/docs/code.ts/readme', 'file-text'],
    ['/project/.env', 'file-text'],
    ['/project/archive.unknown', 'file-text'],
    ['/project/styles.css.backup', 'file-text'],
    ['file:///broken%uri', 'file-text'],
  ])('derives a conservative identity from the basename of %s', (path, expected) => {
    expect(resolveFileSystemEntryIconKind(path, 'file')).toBe(expected)
  })

  it('keeps directory identity independent of its filename extension', () => {
    expect(resolveFileSystemEntryIconKind('/project/package.json', 'directory')).toBe('folder')
  })

  it('reuses the exact same decorative glyph in entries and node motion anchors', () => {
    const onPointerDown = vi.fn()
    const { container } = render(
      <div onPointerDown={onPointerDown}>
        <FileSystemEntryIcon path="file:///project/agent.ts" kind="file" />
        <NodeKindIcon kind="document" filePath="file:///project/agent.ts" />
        <NodeKindIcon kind="folder" />
      </div>,
    )
    const entry = container.querySelector('[data-cove-file-icon="file-code-2"]')!
    const document = container.querySelector('[data-cove-node-kind-icon="document"]')!
    const folder = container.querySelector('[data-cove-node-kind-icon="folder"]')!
    expect(entry.innerHTML).toBe(document.innerHTML)
    expect(document).toHaveClass('cove-node-kind-icon')
    expect(folder).toHaveClass('lucide-folder')
    for (const icon of [entry, document, folder]) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('focusable', 'false')
      expect(icon).not.toHaveAttribute('tabindex')
      fireEvent.pointerDown(icon)
    }
    expect(onPointerDown).toHaveBeenCalledTimes(3)
  })
})
