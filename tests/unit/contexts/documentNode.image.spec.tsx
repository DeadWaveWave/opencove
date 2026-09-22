import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentNode } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode'

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  readFileBytes: vi.fn(),
  readFileText: vi.fn(),
  writeFileText: vi.fn(),
  createUrl: vi.fn(),
  revokeUrl: vi.fn(),
}))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => ({ t: mocks.t }) }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.monaco',
  () => ({
    DocumentNodeMonacoEditor: () => <div data-testid="editor" />,
  }),
)
vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/nodeFrameResize', () => ({
  useNodeFrameResize: () => ({ draftFrame: null, handleResizePointerDown: vi.fn() }),
}))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/mountAwareFilesystemApi',
  () => ({
    resolveFilesystemApiForMount: () => ({
      stat: async ({ uri }: { uri: string }) => ({ uri, kind: 'file', sizeBytes: 10, mtimeMs: 1 }),
      readFileBytes: mocks.readFileBytes,
      readFileText: mocks.readFileText,
      writeFileText: mocks.writeFileText,
    }),
  }),
)

const props = {
  title: 'screenshot.png',
  uri: 'file:///repo/screenshot.png',
  mountId: null,
  position: { x: 0, y: 0 },
  width: 500,
  height: 400,
  onClose: vi.fn(),
  onResize: vi.fn(),
}
function deferredBytes() {
  let resolve!: (value: { bytes: Uint8Array }) => void
  const promise = new Promise<{ bytes: Uint8Array }>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('URI-backed image window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('React', React)
    mocks.readFileBytes.mockResolvedValue({ bytes: Uint8Array.of(137, 80, 78, 71) })
    mocks.createUrl.mockReturnValue('blob:preview')
    vi.stubGlobal('opencoveApi', { sync: { onStateUpdated: () => () => undefined } })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(mocks.createUrl)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mocks.revokeUrl)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders a preview, acknowledges navigation and never exposes text editing', async () => {
    const onNavigationApplied = vi.fn()
    const view = render(
      <DocumentNode
        {...props}
        navigation={{ requestId: 3, uri: props.uri, mountId: null, line: 1 }}
        onNavigationApplied={onNavigationApplied}
      />,
    )
    expect(await screen.findByTestId('document-node-image')).toHaveAttribute('src', 'blob:preview')
    expect(screen.queryByTestId('editor')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull()
    expect(mocks.readFileText).not.toHaveBeenCalled()
    expect(mocks.writeFileText).not.toHaveBeenCalled()
    expect(onNavigationApplied).toHaveBeenCalledWith(3)
    view.unmount()
    expect(mocks.revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:preview')
  })

  it('reports failed image decoding without falling back to editable text', async () => {
    render(<DocumentNode {...props} />)
    fireEvent.error(await screen.findByTestId('document-node-image'))
    expect(await screen.findByText('documentNode.imageUnsupportedTitle')).toBeVisible()
    expect(screen.queryByTestId('editor')).toBeNull()
    expect(mocks.readFileText).not.toHaveBeenCalled()
  })

  it('discards an old URI read after the same window changes source', async () => {
    const old = deferredBytes()
    mocks.readFileBytes.mockReturnValueOnce(old.promise)
    const view = render(<DocumentNode {...props} />)
    await waitFor(() => expect(mocks.readFileBytes).toHaveBeenCalledOnce())
    view.rerender(<DocumentNode {...props} uri="file:///repo/new.png" />)
    await screen.findByTestId('document-node-image')
    await act(async () => old.resolve({ bytes: Uint8Array.of(1) }))
    expect(mocks.createUrl).toHaveBeenCalledOnce()
  })

  it('does not allocate a preview URL for a window closed during the read', async () => {
    const pending = deferredBytes()
    mocks.readFileBytes.mockReturnValueOnce(pending.promise)
    const view = render(<DocumentNode {...props} />)
    await waitFor(() => expect(mocks.readFileBytes).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => pending.resolve({ bytes: Uint8Array.of(1) }))
    expect(mocks.createUrl).not.toHaveBeenCalled()
  })
})
