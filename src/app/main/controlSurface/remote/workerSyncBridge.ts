import { webContents } from 'electron'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { SyncEventPayload } from '../../../../shared/contracts/dto'
import type { ControlSurfaceRemoteEndpointResolver } from './controlSurfaceHttpClient'

class WorkerEndpointUnavailableError extends Error {
  constructor() {
    super('Worker endpoint unavailable.')
    this.name = 'WorkerEndpointUnavailableError'
  }
}

function sendToAllWindows<Payload>(channel: string, payload: Payload): void {
  for (const content of webContents.getAllWebContents()) {
    if (content.isDestroyed() || content.getType() !== 'window') {
      continue
    }

    try {
      content.send(channel, payload)
    } catch {
      // ignore
    }
  }
}

export function registerWorkerSyncBridge(endpointResolver: ControlSurfaceRemoteEndpointResolver): {
  dispose: () => void
} {
  let disposed = false
  let lastRevision = 0
  const abortController = new AbortController()

  const connectOnce = async (): Promise<void> => {
    const endpoint = await endpointResolver()
    if (!endpoint) {
      throw new WorkerEndpointUnavailableError()
    }

    const url = `http://${endpoint.hostname}:${endpoint.port}/events?afterRevision=${lastRevision}`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${endpoint.token}`,
      },
      signal: abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`sync bridge failed: HTTP ${response.status}`)
    }

    if (!response.body) {
      throw new Error('sync bridge failed: missing response body')
    }

    const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
    let buffer = ''
    let currentEventName: string | null = null
    let currentEventId: string | null = null
    let currentDataLines: string[] = []

    const dispatch = (): void => {
      if (!currentDataLines.length) {
        currentEventName = null
        currentEventId = null
        currentDataLines = []
        return
      }

      const rawData = currentDataLines.join('\n')

      if (currentEventName !== 'opencove.sync') {
        currentEventName = null
        currentEventId = null
        currentDataLines = []
        return
      }

      try {
        const parsed = JSON.parse(rawData) as unknown
        if (!parsed || typeof parsed !== 'object') {
          return
        }

        const payload = parsed as SyncEventPayload
        if (typeof payload.revision === 'number' && Number.isFinite(payload.revision)) {
          lastRevision = Math.max(lastRevision, payload.revision)
        } else if (typeof currentEventId === 'string') {
          const idParsed = Number.parseInt(currentEventId, 10)
          if (Number.isFinite(idParsed) && idParsed >= 0) {
            lastRevision = Math.max(lastRevision, idParsed)
          }
        }

        sendToAllWindows(IPC_CHANNELS.syncStateUpdated, payload)
      } finally {
        currentEventName = null
        currentEventId = null
        currentDataLines = []
      }
    }

    await new Promise<void>((resolve, reject) => {
      const handleChunk = (chunk: unknown): void => {
        buffer += String(chunk)

        while (true) {
          const newlineIndex = buffer.indexOf('\n')
          if (newlineIndex === -1) {
            break
          }

          let line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)

          if (line.endsWith('\r')) {
            line = line.slice(0, -1)
          }

          if (line === '') {
            dispatch()
            continue
          }

          if (line.startsWith(':')) {
            continue
          }

          if (line.startsWith('event:')) {
            currentEventName = line.slice('event:'.length).trim()
            continue
          }

          if (line.startsWith('id:')) {
            currentEventId = line.slice('id:'.length).trim()
            continue
          }

          if (line.startsWith('data:')) {
            currentDataLines.push(line.slice('data:'.length).trimStart())
            continue
          }
        }

        if (disposed) {
          stream.destroy()
          resolve()
        }
      }

      const handleEnd = (): void => {
        stream.off('data', handleChunk)
        stream.off('error', handleError)
        resolve()
      }

      const handleError = (error: unknown): void => {
        stream.off('data', handleChunk)
        stream.off('end', handleEnd)
        reject(error)
      }

      stream.on('data', handleChunk)
      stream.on('end', handleEnd)
      stream.on('error', handleError)
    })
  }

  const connectLoop = (): void => {
    void connectOnce()
      .then(() => {
        if (disposed) {
          return
        }

        setTimeout(() => {
          connectLoop()
        }, 0)
      })
      .catch(error => {
        if (disposed) {
          return
        }

        if (!(error instanceof WorkerEndpointUnavailableError)) {
          const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          process.stderr.write(`[opencove] worker sync bridge reconnecting: ${detail}\n`)
        }
        setTimeout(() => {
          connectLoop()
        }, 750)
      })
  }

  connectLoop()

  return {
    dispose: () => {
      if (disposed) {
        return
      }

      disposed = true
      try {
        abortController.abort()
      } catch {
        // ignore
      }
    },
  }
}
