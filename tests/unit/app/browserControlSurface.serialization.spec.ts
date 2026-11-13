import type { ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { sendJson } from '@app/main/controlSurface/http/httpJson'
import { invokeBrowserControlSurface } from '@app/renderer/browser/browserControlSurface'

// Use the production HTTP serializer without opening a sandbox-forbidden listener.
function serialized(body: unknown): Response {
  let raw = ''
  const sink = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: (data: string) => {
      raw = data
    },
  }
  sendJson(sink as unknown as ServerResponse, 200, body)
  return new Response(raw)
}
afterEach(() => vi.unstubAllGlobals())
it.each([
  'filesystem.writeFileText',
  'filesystem.renameEntry',
  'filesystem.deleteEntry',
  'filesystem.createDirectory',
])('resolves a completed %s void command after real HTTP serialization', async id => {
  const mutate = vi.fn(async () => undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      serialized({ __opencoveControlEnvelope: true, ok: true, value: await mutate() }),
    ),
  )
  await expect(
    invokeBrowserControlSurface<void>({ kind: 'command', id, payload: {} }),
  ).resolves.toBeUndefined()
  expect(mutate).toHaveBeenCalledTimes(1)
})
it('validates required payloads separately from the transport envelope', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => serialized({ __opencoveControlEnvelope: true, ok: true, value: undefined })),
  )
  await expect(
    invokeBrowserControlSurface(
      { kind: 'query', id: 'sync.state', payload: {} },
      value => value !== undefined,
    ),
  ).rejects.toMatchObject({ name: 'RendererTransportError' })
})
it('rejects a missing required persistence read without classifying it as an application rejection', async () => {
  const { createBrowserPersistenceApi } =
    await import('@app/renderer/browser/browserOpenCoveApi.persistence')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => serialized({ __opencoveControlEnvelope: true, ok: true })),
  )
  await expect(createBrowserPersistenceApi().readAppState()).rejects.toMatchObject({
    name: 'RendererTransportError',
  })
})
