import { describe, expect, it, vi } from 'vitest'
import { loadDocumentNodeContent } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.helpers'
import { resolveDocumentNodeMediaDescriptor } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.media'
import { resolveDocumentNodeSizeFromMediaMetadata } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceNodeSizing'

const LOAD_MESSAGES = {
  notAFile: 'not a file',
  binaryReadUnavailable: 'binary reads unavailable',
}

describe('DocumentNode helpers', () => {
  it('detects VS Code built-in previewable audio/video extensions', () => {
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/tone.mp3')).toEqual({
      kind: 'audio',
      mimeType: 'audio/mpeg',
    })
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/tone.ogg')).toEqual({
      kind: 'audio',
      mimeType: 'audio/ogg',
    })
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/tone.oga')).toEqual({
      kind: 'audio',
      mimeType: 'audio/ogg',
    })
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/tone.wav')).toEqual({
      kind: 'audio',
      mimeType: 'audio/wav',
    })
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/tone.wave')).toEqual({
      kind: 'audio',
      mimeType: 'audio/wav',
    })
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/clip.mp4')).toEqual({
      kind: 'video',
      mimeType: 'video/mp4',
    })
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/clip.webm')).toEqual({
      kind: 'video',
      mimeType: 'video/webm',
    })
    expect(resolveDocumentNodeMediaDescriptor('file:///tmp/readme.md')).toBeNull()
  })

  it('loads media files through readFileBytes without falling back to text reads', async () => {
    const readFileBytes = vi.fn(async () => ({
      bytes: Uint8Array.from([1, 2, 3, 4]),
    }))
    const readFileText = vi.fn(async () => ({ content: 'should not be used' }))

    const result = await loadDocumentNodeContent(
      {
        stat: async () => ({
          uri: 'file:///tmp/tone.mp3',
          kind: 'file',
          sizeBytes: 4,
          mtimeMs: null,
        }),
        readFileBytes,
        readFileText,
      },
      'file:///tmp/tone.mp3',
      LOAD_MESSAGES,
    )

    expect(result).toEqual({
      kind: 'media',
      mediaKind: 'audio',
      mimeType: 'audio/mpeg',
      bytes: Uint8Array.from([1, 2, 3, 4]),
    })
    expect(readFileBytes).toHaveBeenCalledOnce()
    expect(readFileText).not.toHaveBeenCalled()
  })

  it('returns a clear error when media bytes cannot be loaded in the current runtime', async () => {
    await expect(
      loadDocumentNodeContent(
        {
          stat: async () => ({
            uri: 'file:///tmp/clip.mp4',
            kind: 'file',
            sizeBytes: 16,
            mtimeMs: null,
          }),
          readFileText: async () => ({ content: 'unused' }),
        },
        'file:///tmp/clip.mp4',
        LOAD_MESSAGES,
      ),
    ).rejects.toThrow('binary reads unavailable')
  })

  it('keeps audio windows compact and fits video windows to their aspect ratio', () => {
    const audioSize = resolveDocumentNodeSizeFromMediaMetadata({
      mediaKind: 'audio',
      naturalWidth: null,
      naturalHeight: null,
      preferred: { width: 520, height: 420 },
    })
    expect(audioSize).toEqual({ width: 520, height: 260 })

    const videoSize = resolveDocumentNodeSizeFromMediaMetadata({
      mediaKind: 'video',
      naturalWidth: 96,
      naturalHeight: 54,
      preferred: { width: 520, height: 420 },
    })
    expect(videoSize.width).toBeGreaterThan(videoSize.height)
    expect(videoSize.width).toBeGreaterThanOrEqual(520)
    expect(videoSize.height).toBeGreaterThanOrEqual(260)
  })
})
