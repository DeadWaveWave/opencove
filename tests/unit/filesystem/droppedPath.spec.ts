import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { resolveDroppedPath } from '@contexts/filesystem/presentation/main-ipc/droppedPath'
import { createApprovedWorkspaceStoreForPath } from '@contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'

const electron = vi.hoisted(() => ({ fromWebContents: vi.fn(), app: { isPackaged: false } }))
vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: { fromWebContents: electron.fromWebContents },
}))

const modulePath = resolve('src/contexts/filesystem/presentation/main-ipc')
function sender() {
  const mainFrame = { url: pathToFileURL(resolve(modulePath, '../renderer/index.html')).href }
  const webContents = { mainFrame }
  electron.fromWebContents.mockReturnValue({ webContents })
  return { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
}

describe('native dropped path approval', () => {
  let root: string
  beforeEach(async () => {
    electron.app.isPackaged = false
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    root = await mkdtemp(join(tmpdir(), 'opencove-drop-approval-'))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'note.md'), 'Native file')
    await writeFile(join(root, 'sibling.md'), 'Keep private')
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  it.each([
    ['note.md', 'file'],
    ['docs', 'directory'],
  ])('authorizes only the explicit %s entry and verifies its actual type', async (name, kind) => {
    const store = createApprovedWorkspaceStoreForPath(join(root, 'approved.json'))
    const entry = join(root, name)
    const result = await resolveDroppedPath(sender(), { path: entry }, store)
    expect(result).toMatchObject({ uri: pathToFileURL(entry).href, kind })
    expect(await store.isPathApproved(entry)).toBe(true)
    expect(await store.isPathApproved(root)).toBe(false)
    expect(await store.isPathApproved(join(root, 'sibling.md'))).toBe(false)
    const reloaded = createApprovedWorkspaceStoreForPath(join(root, 'approved.json'))
    expect(await reloaded.isPathApproved(entry)).toBe(true)
  })

  it.each(['relative.md', '', '/tmp/bad\0path'])(
    'rejects malformed native path %j without authorization',
    async path => {
      const store = { registerRoot: vi.fn(), isPathApproved: vi.fn() }
      await expect(resolveDroppedPath(sender(), { path }, store)).rejects.toThrow()
      expect(store.registerRoot).not.toHaveBeenCalled()
    },
  )

  it('does not grant access when the native item no longer exists', async () => {
    const store = { registerRoot: vi.fn(), isPathApproved: vi.fn() }
    await expect(
      resolveDroppedPath(sender(), { path: join(root, 'gone.md') }, store),
    ).rejects.toThrow()
    expect(store.registerRoot).not.toHaveBeenCalled()
  })

  it('trusts the packaged renderer even when the launch environment contains a development URL', async () => {
    electron.app.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/')
    const store = { registerRoot: vi.fn(), isPathApproved: vi.fn() }
    await expect(
      resolveDroppedPath(sender(), { path: join(root, 'note.md') }, store),
    ).resolves.toMatchObject({ kind: 'file' })
    const foreign = sender()
    Object.assign(foreign.senderFrame!, { url: 'http://localhost:5173/' })
    await expect(
      resolveDroppedPath(foreign, { path: join(root, 'note.md') }, store),
    ).rejects.toThrow()
    expect(store.registerRoot).toHaveBeenCalledOnce()
  })

  it('accepts the configured development renderer origin only in development', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/')
    const event = sender()
    Object.assign(event.senderFrame!, { url: 'http://localhost:5173/#canvas' })
    const store = { registerRoot: vi.fn(), isPathApproved: vi.fn() }
    await expect(
      resolveDroppedPath(event, { path: join(root, 'note.md') }, store),
    ).resolves.toMatchObject({ kind: 'file' })
  })

  it.each(['subframe', 'foreign-window', 'foreign-url', 'no-owner'])(
    'rejects %s even with a real local file',
    async invalid => {
      const event = sender()
      if (invalid === 'subframe') {
        Object.assign(event, { senderFrame: { ...event.senderFrame } })
      }
      if (invalid === 'foreign-window') {
        electron.fromWebContents.mockReturnValue({ webContents: {} })
      }
      if (invalid === 'foreign-url') {
        Object.assign(event.senderFrame!, { url: 'https://example.com' })
      }
      if (invalid === 'no-owner') {
        electron.fromWebContents.mockReturnValue(null)
      }
      const store = { registerRoot: vi.fn(), isPathApproved: vi.fn() }
      await expect(
        resolveDroppedPath(event, { path: join(root, 'note.md') }, store),
      ).rejects.toThrow()
      expect(store.registerRoot).not.toHaveBeenCalled()
    },
  )
})
