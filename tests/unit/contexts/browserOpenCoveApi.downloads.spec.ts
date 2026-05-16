import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBrowserOpenCoveApi } from '../../../src/app/renderer/browser/browserOpenCoveApi'

function setShowSaveFilePicker(value: unknown): void {
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value,
  })
}

describe('browser OpenCove API downloads', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
    delete (window as typeof window & { showSaveFilePicker?: unknown }).showSaveFilePicker
  })

  it('saves text through the browser save file picker when available', async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const createWritable = vi.fn(async () => ({ write, close }))
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }))
    setShowSaveFilePicker(showSaveFilePicker)

    installBrowserOpenCoveApi()

    await expect(
      window.opencoveApi.system.saveTextToDownloads({
        fileName: 'note.md',
        content: '# Hello',
      }),
    ).resolves.toEqual({
      status: 'saved',
      fileName: 'note.md',
      path: null,
    })
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'note.md',
      types: [
        {
          description: 'Markdown',
          accept: { 'text/markdown': ['.md'] },
        },
      ],
    })
    expect(write).toHaveBeenCalledWith('# Hello')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('falls back to browser download when save file picker is unavailable', async () => {
    vi.useFakeTimers()
    setShowSaveFilePicker(undefined)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:note')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    installBrowserOpenCoveApi()

    await expect(
      window.opencoveApi.system.saveTextToDownloads({
        fileName: 'note.md',
        content: '# Hello',
      }),
    ).resolves.toEqual({
      status: 'download-started',
      fileName: 'note.md',
      path: null,
    })
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)

    vi.runAllTimers()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:note')
  })
})
