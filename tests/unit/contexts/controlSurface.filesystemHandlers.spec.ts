import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerFilesystemHandlers } from '../../../src/app/main/controlSurface/handlers/filesystemHandlers'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-03-27T00:00:00.000Z'),
}

describe('control surface filesystem handlers', () => {
  it('reads file content when approved', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'opencove-test-fs-'))
    const filePath = join(baseDir, 'hello.txt')
    await writeFile(filePath, 'hello', 'utf8')

    const controlSurface = createControlSurface()
    registerFilesystemHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'filesystem.readFileText',
      payload: { uri: toFileUri(filePath) },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ content: 'hello' })
    }
  })

  it('rejects unapproved paths', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'opencove-test-fs-'))
    const filePath = join(baseDir, 'hello.txt')
    await writeFile(filePath, 'hello', 'utf8')

    const controlSurface = createControlSurface()
    registerFilesystemHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => false,
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'filesystem.readFileText',
      payload: { uri: toFileUri(filePath) },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('common.approved_path_required')
    }
  })

  it('rejects invalid payloads', async () => {
    const controlSurface = createControlSurface()
    registerFilesystemHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'filesystem.readFileText',
      payload: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('common.invalid_input')
    }
  })
})

