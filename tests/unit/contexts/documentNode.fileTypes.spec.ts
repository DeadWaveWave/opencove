import { describe, expect, it, vi } from 'vitest'
import { loadDocumentNodeContent } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.helpers'
import { resolveDocumentNodeMediaDescriptor } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.media'

const messages = { notAFile: 'not a file', binaryReadUnavailable: 'bytes unavailable' }

describe('URI-backed document file types', () => {
  it('rejects oversized image previews before allocating file bytes', async () => {
    const uri = 'file:///repo/huge.png'
    const readFileBytes = vi.fn()
    const readFileText = vi.fn()
    expect(
      await loadDocumentNodeContent(
        {
          stat: async () => ({ uri, kind: 'file', sizeBytes: 51 * 1024 * 1024, mtimeMs: 1 }),
          readFileBytes,
          readFileText,
        },
        uri,
        messages,
      ),
    ).toMatchObject({ kind: 'unsupported', unsupportedKind: 'imageTooLarge' })
    expect(readFileBytes).not.toHaveBeenCalled()
    expect(readFileText).not.toHaveBeenCalled()
  })
  it.each([
    ['PNG', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
    ['gif', 'image/gif'],
    ['avif', 'image/avif'],
    ['svg', 'image/svg+xml'],
    ['bmp', 'image/bmp'],
    ['ico', 'image/x-icon'],
  ])('loads %s as an image without decoding it as text', async (extension, mimeType) => {
    const uri = `file:///repo/screenshot.${extension}`
    const bytes = Uint8Array.from([137, 80, 78, 71, 0])
    const readFileBytes = vi.fn(async () => ({ bytes }))
    const readFileText = vi.fn(async () => ({ content: 'binary' }))
    const result = await loadDocumentNodeContent(
      {
        stat: async () => ({ uri, kind: 'file', sizeBytes: 8_000_000, mtimeMs: 1 }),
        readFileBytes,
        readFileText,
      },
      uri,
      messages,
    )
    expect(result).toMatchObject({ kind: 'media', mediaKind: 'image', mimeType, bytes })
    expect(readFileBytes).toHaveBeenCalledExactlyOnceWith({ uri })
    expect(readFileText).not.toHaveBeenCalled()
  })

  it.each(['pdf', 'docx', 'xlsx', 'zip'])(
    'never sends known binary %s to the editor',
    async ext => {
      const uri = `file:///repo/file.${ext}`
      const readFileText = vi.fn(async () => ({ content: '%PDF-1.4 readable header' }))
      expect(
        await loadDocumentNodeContent(
          {
            stat: async () => ({ uri, kind: 'file', sizeBytes: 40, mtimeMs: 1 }),
            readFileText,
          },
          uri,
          messages,
        ),
      ).toMatchObject({ kind: 'unsupported', unsupportedKind: 'binary' })
      expect(readFileText).not.toHaveBeenCalled()
    },
  )

  it('treats malformed and non-file URIs as unclassified', () => {
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/bad%ZZ.png')).toBeNull()
    expect(resolveDocumentNodeMediaDescriptor('https://example.com/a.png')).toBeNull()
  })

  it('preserves unknown text editing and binary detection', async () => {
    const uri = 'file:///repo/config.custom'
    const api = {
      stat: async () => ({ uri, kind: 'file' as const, sizeBytes: 40, mtimeMs: 1 }),
      readFileText: vi.fn(async () => ({ content: 'hello' })),
    }
    expect(await loadDocumentNodeContent(api, uri, messages)).toMatchObject({
      kind: 'text',
      content: 'hello',
    })
    api.readFileText.mockResolvedValue({ content: 'hello\0world' })
    expect(await loadDocumentNodeContent(api, uri, messages)).toMatchObject({
      kind: 'unsupported',
      unsupportedKind: 'binary',
    })
  })
})
