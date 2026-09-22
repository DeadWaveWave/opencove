import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { DocumentNodeBody } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNodeBody'

const { canOpen, editor } = vi.hoisted(() => ({
  canOpen: vi.fn<() => Promise<boolean>>(),
  editor: vi.fn(() => null),
}))

vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/systemFileOpening', () => ({
  canOpenSystemFile: canOpen,
  openSystemFile: vi.fn(),
}))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.monaco',
  () => ({
    DocumentNodeMonacoEditor: editor,
  }),
)

const props = {
  uri: 'file:///repo/Release%20notes.PDF',
  mountId: null,
  isLoading: false,
  loadError: null,
  mediaLoadError: false,
  unsupportedKind: 'binary' as const,
  mediaSource: null,
  interactiveContentClassName: '',
  hasExternalConflict: false,
  onRetry: vi.fn(),
  onReloadFromDisk: vi.fn(),
  saveError: null,
  content: 'Unreadable bytes must not become an editor',
  onContentChange: vi.fn(),
  onSaveShortcut: vi.fn(),
  onMediaError: vi.fn(),
}

beforeEach(async () => {
  vi.clearAllMocks()
  canOpen.mockResolvedValue(true)
  await applyUiLanguage('en')
})

afterEach(async () => {
  await applyUiLanguage('en')
})

describe('DocumentNode binary file placeholder', () => {
  it.each([
    ['en', 'Preview is not yet available for PDF files.', 'Open with default app'],
    ['zh-CN', '暂不支持预览 PDF 文件', '使用默认应用打开'],
  ] as const)(
    'shows a readable file identity and explicit action in %s',
    async (language, message, action) => {
      await applyUiLanguage(language)
      render(<DocumentNodeBody {...props} />)
      expect(screen.getByTestId('document-node-file-name')).toHaveTextContent('Release notes.PDF')
      expect(screen.getByTestId('document-node-file-preview-message')).toHaveTextContent(message)
      expect(await screen.findByRole('button', { name: action })).toBeEnabled()
      expect(editor).not.toHaveBeenCalled()
    },
  )

  it('keeps a generic explanation and no local opening action for a remote extensionless file', async () => {
    canOpen.mockResolvedValue(false)
    render(<DocumentNodeBody {...props} uri="file:///repo/blob" mountId="remote-mount" />)
    expect(screen.getByTestId('document-node-file-name')).toHaveTextContent('blob')
    expect(screen.getByTestId('document-node-file-preview-message')).toHaveTextContent(
      'Preview unavailable',
    )
    await waitFor(() => expect(canOpen).toHaveBeenCalled())
    expect(screen.queryByTestId('document-node-open-system')).toBeNull()
    expect(editor).not.toHaveBeenCalled()
  })

  it('does not claim text formats are unsupported when their contents cannot be decoded', () => {
    render(<DocumentNodeBody {...props} uri="file:///repo/notes.txt" />)
    expect(screen.getByTestId('document-node-file-preview-message')).toHaveTextContent(
      'Preview unavailable',
    )
    expect(editor).not.toHaveBeenCalled()
  })
})
