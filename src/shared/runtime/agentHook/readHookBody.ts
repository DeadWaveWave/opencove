import type { IncomingMessage } from 'node:http'

const MAX_HOOK_BODY_BYTES = 256 * 1024

export function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_HOOK_BODY_BYTES) {
        reject(new Error('Hook payload exceeds the size limit.'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.once('error', reject)
    request.once('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
  })
}
