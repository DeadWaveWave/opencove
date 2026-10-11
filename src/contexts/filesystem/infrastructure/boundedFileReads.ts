import { open, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { toFileUri } from '../domain/fileUri'
import type { ReadDirectoryResult, ReadFileTextResult } from '../../../shared/contracts/dto'

export async function readBoundedText(path: string, maxBytes: number): Promise<ReadFileTextResult> {
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile()) {
      throw new Error('Plugin text reads require a regular file.')
    }
    if (stat.size > maxBytes) {
      throw new Error('File exceeds the text read limit.')
    }
    const buffer = Buffer.alloc(maxBytes + 1)
    let offset = 0
    // Read from a single handle so replacement cannot swap in a different file mid-read.
    while (offset < buffer.length) {
      // eslint-disable-next-line no-await-in-loop -- Each bounded read advances the same file handle.
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    if (offset > maxBytes) {
      throw new Error('File exceeds the text read limit.')
    }
    return { content: buffer.subarray(0, offset).toString('utf8') }
  } finally {
    await file.close()
  }
}

export async function readBoundedDirectory(
  path: string,
  maxEntries: number,
): Promise<ReadDirectoryResult> {
  const directory = await opendir(path)
  const entries: ReadDirectoryResult['entries'] = []
  for await (const item of directory) {
    if (entries.length >= maxEntries) {
      return { entries, truncated: true }
    }
    entries.push({
      name: item.name,
      uri: toFileUri(join(path, item.name)),
      kind: item.isDirectory() ? 'directory' : item.isFile() ? 'file' : 'unknown',
    })
  }
  return { entries, truncated: false }
}
