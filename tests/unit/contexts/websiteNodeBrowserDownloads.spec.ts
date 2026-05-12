import { describe, expect, it } from 'vitest'
import type {
  BrowserDownloadRecord,
  WebsiteWindowDownloadEvent,
} from '../../../src/shared/contracts/dto'
import { mergeBrowserDownloadRecords } from '../../../src/contexts/workspace/presentation/renderer/components/WebsiteNode.browserDownloads'

describe('mergeBrowserDownloadRecords', () => {
  it('keeps runtime download progress visible ahead of persisted records', () => {
    const runtimeDownload: WebsiteWindowDownloadEvent = {
      type: 'download',
      nodeId: 'web-1',
      downloadId: 'download-1',
      url: 'https://example.test/file.zip',
      filename: 'file.zip',
      receivedBytes: 4,
      totalBytes: 10,
      state: 'progressing',
      savePath: null,
      error: null,
    }
    const persistedDownload: BrowserDownloadRecord = {
      id: 'download-2',
      url: 'https://example.test/old.zip',
      filename: 'old.zip',
      savePath: '/tmp/old.zip',
      state: 'completed',
      receivedBytes: 10,
      totalBytes: 10,
      startedAt: '2026-05-01T10:00:00.000Z',
      endedAt: '2026-05-01T10:01:00.000Z',
      error: null,
    }

    expect(mergeBrowserDownloadRecords([persistedDownload], [runtimeDownload])).toMatchObject([
      { id: 'download-1', state: 'progressing', receivedBytes: 4 },
      { id: 'download-2', state: 'completed' },
    ])
  })

  it('uses runtime records when they overlap persisted downloads', () => {
    const runtimeDownload: WebsiteWindowDownloadEvent = {
      type: 'download',
      nodeId: 'web-1',
      downloadId: 'download-1',
      url: 'https://example.test/file.zip',
      filename: 'file.zip',
      receivedBytes: 8,
      totalBytes: 10,
      state: 'progressing',
      savePath: null,
      error: null,
    }
    const persistedDownload: BrowserDownloadRecord = {
      id: 'download-1',
      url: 'https://example.test/file.zip',
      filename: 'file.zip',
      savePath: '/tmp/file.zip',
      state: 'completed',
      receivedBytes: 10,
      totalBytes: 10,
      startedAt: '2026-05-01T10:00:00.000Z',
      endedAt: '2026-05-01T10:01:00.000Z',
      error: null,
    }

    expect(mergeBrowserDownloadRecords([persistedDownload], [runtimeDownload])).toMatchObject([
      { id: 'download-1', state: 'progressing', receivedBytes: 8, savePath: null },
    ])
  })
})
