import type { BrowserDownloadRecord, WebsiteWindowDownloadEvent } from '@shared/contracts/dto'

export function mergeBrowserDownloadRecords(
  persistedDownloads: BrowserDownloadRecord[],
  runtimeDownloads: WebsiteWindowDownloadEvent[],
): BrowserDownloadRecord[] {
  const runtimeRecords = runtimeDownloads.map(toBrowserDownloadRecord)
  const runtimeIds = new Set(runtimeRecords.map(item => item.id))

  return [...runtimeRecords, ...persistedDownloads.filter(item => !runtimeIds.has(item.id))].slice(
    0,
    50,
  )
}

function toBrowserDownloadRecord(event: WebsiteWindowDownloadEvent): BrowserDownloadRecord {
  return {
    id: event.downloadId,
    url: event.url,
    filename: event.filename,
    savePath: event.savePath,
    state: event.state,
    receivedBytes: event.receivedBytes,
    totalBytes: event.totalBytes,
    startedAt: '',
    endedAt: event.state === 'progressing' ? null : '',
    error: event.error,
  }
}
