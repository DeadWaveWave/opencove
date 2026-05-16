import type { SaveTextToDownloadsInput, SaveTextToDownloadsResult } from '@shared/contracts/dto'

interface BrowserSaveFilePicker {
  createWritable: () => Promise<{
    write: (content: string) => Promise<void>
    close: () => Promise<void>
  }>
}

interface BrowserSaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types?: Array<{
      description: string
      accept: Record<string, string[]>
    }>
  }) => Promise<BrowserSaveFilePicker>
}

function triggerBrowserTextDownload(payload: SaveTextToDownloadsInput): void {
  const blob = new Blob([payload.content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = payload.fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()

  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

export async function saveTextToDownloadsInBrowser(
  payload: SaveTextToDownloadsInput,
): Promise<SaveTextToDownloadsResult> {
  const saveFilePicker = (window as BrowserSaveFilePickerWindow).showSaveFilePicker
  if (typeof saveFilePicker === 'function') {
    try {
      const handle = await saveFilePicker({
        suggestedName: payload.fileName,
        types: [
          {
            description: 'Markdown',
            accept: { 'text/markdown': ['.md'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(payload.content)
      await writable.close()
      return { status: 'saved', fileName: payload.fileName, path: null }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { status: 'canceled', fileName: payload.fileName, path: null }
      }
      throw error
    }
  }

  triggerBrowserTextDownload(payload)
  return { status: 'download-started', fileName: payload.fileName, path: null }
}
