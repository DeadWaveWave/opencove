import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerFilesystemHandlers } from '../../../src/app/main/controlSurface/handlers/filesystemHandlers'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-03-27T00:00:00.000Z'),
}

async function createFixture(): Promise<{ baseDir: string; filePath: string }> {
  const baseDir = await mkdtemp(join(tmpdir(), 'opencove-test-fs-'))
  const filePath = join(baseDir, 'hello.txt')
  await writeFile(filePath, 'hello', 'utf8')
  await mkdir(join(baseDir, 'subdir'))
  return { baseDir, filePath }
}

function createSubject(isApproved: boolean) {
  const controlSurface = createControlSurface()
  registerFilesystemHandlers(controlSurface, {
    approvedWorkspaces: {
      registerRoot: async () => undefined,
      isPathApproved: async () => isApproved,
    },
  })
  return controlSurface
}

describe('control surface filesystem handlers', () => {
  it('reads file content when approved', async () => {
    const { filePath } = await createFixture()
    const controlSurface = createSubject(true)

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

  it('writes file content when approved', async () => {
    const { filePath } = await createFixture()
    const controlSurface = createSubject(true)
    const uri = toFileUri(filePath)

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'filesystem.writeFileText',
      payload: { uri, content: 'next' },
    })

    expect(result.ok).toBe(true)
    expect(await readFile(filePath, 'utf8')).toBe('next')
  })

  it('stats a file when approved', async () => {
    const { filePath } = await createFixture()
    const controlSurface = createSubject(true)
    const uri = toFileUri(filePath)

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'filesystem.stat',
      payload: { uri },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(
        expect.objectContaining({
          uri,
          kind: 'file',
        }),
      )
    }
  })

  it('lists directory entries when approved', async () => {
    const { baseDir } = await createFixture()
    const controlSurface = createSubject(true)
    const uri = toFileUri(baseDir)

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'filesystem.readDirectory',
      payload: { uri },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.entries.map(entry => entry.name)).toContain('hello.txt')
    }
  })

  it.each([
    [
      'filesystem.readFileText',
      'query',
      async ({ filePath }: { filePath: string }) => ({ uri: toFileUri(filePath) }),
    ],
    [
      'filesystem.writeFileText',
      'command',
      async ({ filePath }: { filePath: string }) => ({ uri: toFileUri(filePath), content: 'next' }),
    ],
    [
      'filesystem.stat',
      'query',
      async ({ filePath }: { filePath: string }) => ({ uri: toFileUri(filePath) }),
    ],
    [
      'filesystem.readDirectory',
      'query',
      async ({ baseDir }: { baseDir: string }) => ({ uri: toFileUri(baseDir) }),
    ],
  ] as const)('rejects unapproved paths for %s', async (id, kind, buildPayload) => {
    const fixture = await createFixture()
    const controlSurface = createSubject(false)

    const result = await controlSurface.invoke(ctx, {
      kind,
      id,
      payload: await buildPayload(fixture),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('common.approved_path_required')
    }
  })

  it.each([
    [
      'filesystem.readFileText',
      'query',
      {
        invalidPayload: null,
        invalidSchemePayload: { uri: 'https://example.com/file.txt' },
        invalidUriPayload: { uri: 'not a uri' },
      },
    ],
    [
      'filesystem.writeFileText',
      'command',
      {
        invalidPayload: null,
        invalidSchemePayload: { uri: 'https://example.com/file.txt', content: 'x' },
        invalidUriPayload: { uri: 'not a uri', content: 'x' },
      },
    ],
    [
      'filesystem.stat',
      'query',
      {
        invalidPayload: null,
        invalidSchemePayload: { uri: 'https://example.com/file.txt' },
        invalidUriPayload: { uri: 'not a uri' },
      },
    ],
    [
      'filesystem.readDirectory',
      'query',
      {
        invalidPayload: null,
        invalidSchemePayload: { uri: 'https://example.com/dir' },
        invalidUriPayload: { uri: 'not a uri' },
      },
    ],
  ] as const)('rejects invalid inputs for %s', async (id, kind, cases) => {
    const controlSurface = createSubject(true)

    const payloads = [cases.invalidPayload, cases.invalidSchemePayload, cases.invalidUriPayload]
    const results = await Promise.all(
      payloads.map(payload => controlSurface.invoke(ctx, { kind, id, payload })),
    )

    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('common.invalid_input')
      }
    }
  })

  it('rejects invalid payload shapes for writeFileText', async () => {
    const { filePath } = await createFixture()
    const controlSurface = createSubject(true)

    const result = await controlSurface.invoke(ctx, {
      kind: 'command',
      id: 'filesystem.writeFileText',
      payload: { uri: toFileUri(filePath), content: 123 },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('common.invalid_input')
    }
  })
})
