import { CliError } from './errors'
/** UTF-8 SSE parser with a per-frame wire-byte budget, including comments. */
export async function* sseFrames(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onOpen?: () => Promise<void>,
): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) {
    abort()
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let line = '',
    data: string[] = [],
    pendingCr = false,
    size = 0
  const finishLine = () => {
    const current = line
    line = ''
    if (!current) {
      const payload = data.length ? data.join('\n') : undefined
      data = []
      size = 0
      return payload
    }
    if (current.startsWith('data:')) {
      data.push(current.slice(5).replace(/^ /, ''))
    }
    return undefined
  }
  try {
    await onOpen?.()
    while (!signal.aborted) {
      // Framing must consume one chunk at a time.
      const chunk = await reader.read()
      if (chunk.done) {
        return
      } // Incomplete trailing records are never acknowledged.
      let start = 0
      for (let i = 0; i < chunk.value.length; i++) {
        const byte = chunk.value[i]
        if (pendingCr) {
          pendingCr = false
          if (byte === 10) {
            start = i + 1
            continue
          }
        }
        if (byte !== 10 && byte !== 13) {
          continue
        }
        const segment = chunk.value.subarray(start, i + 1)
        size += segment.byteLength
        if (size > 1024 * 1024) {
          throw new CliError('agent.stream_invalid', 5, 'Event exceeded the 1 MiB frame limit.')
        }
        line += decoder.decode(segment, { stream: true }).slice(0, -1)
        start = i + 1
        pendingCr = byte === 13
        const payload = finishLine()
        if (payload !== undefined) {
          try {
            yield JSON.parse(payload)
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new CliError('agent.stream_invalid', 5, 'Invalid JSON in event stream.')
            }
            throw error
          }
        }
      }
      const tail = chunk.value.subarray(start)
      size += tail.byteLength
      if (size > 1024 * 1024) {
        throw new CliError('agent.stream_invalid', 5, 'Event exceeded the 1 MiB frame limit.')
      }
      line += decoder.decode(tail, { stream: true })
    }
  } catch (error) {
    if (error instanceof TypeError && /encoded data/.test(error.message)) {
      throw new CliError('agent.stream_invalid', 5, 'Invalid UTF-8 in event stream.')
    }
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
