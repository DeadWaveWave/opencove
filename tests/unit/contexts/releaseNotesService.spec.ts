import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('ReleaseNotesService', () => {
  afterEach(() => {
    delete process.env.OPENCOVE_RELEASE_NOTES_MANIFEST_PATH
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('loads localized release notes from the embedded manifest path override', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'opencove-release-notes-'))
    const manifestPath = resolve(tempDir, 'release-manifest.json')

    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        version: '0.2.0',
        channel: 'stable',
        publishedAt: '2026-03-23T00:00:00.000Z',
        provenance: 'curated',
        defaultLocale: 'en',
        compareUrl: 'https://example.com/release',
        locales: {
          en: { summary: 'English summary', items: [] },
          'zh-CN': {
            summary: '中文摘要',
            items: [
              {
                kind: 'added',
                summary: '新增本地化版本说明。',
                url: null,
                prNumber: null,
                sha: null,
              },
            ],
          },
        },
      }),
      'utf8',
    )

    process.env.OPENCOVE_RELEASE_NOTES_MANIFEST_PATH = manifestPath
    vi.doMock('electron', () => ({
      app: { isPackaged: false },
    }))

    const { createReleaseNotesService } =
      await import('../../../src/contexts/releaseNotes/infrastructure/main/ReleaseNotesService')
    const service = createReleaseNotesService()

    await expect(
      service.getCurrent({ currentVersion: '0.2.0', language: 'zh-CN' }),
    ).resolves.toMatchObject({
      provenance: 'curated',
      summary: '中文摘要',
      compareUrl: 'https://example.com/release',
      items: [{ summary: '新增本地化版本说明。' }],
    })

    await rm(tempDir, { recursive: true, force: true })
  })

  it('falls back to the default locale when the requested locale is missing', async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), 'opencove-release-notes-'))
    const manifestPath = resolve(tempDir, 'release-manifest.json')

    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        version: '0.2.0',
        channel: 'stable',
        publishedAt: '2026-03-23T00:00:00.000Z',
        provenance: 'curated',
        defaultLocale: 'en',
        compareUrl: null,
        locales: {
          en: {
            summary: 'English summary',
            items: [
              {
                kind: 'fixed',
                summary: 'Fixed the durable release source.',
                url: null,
                prNumber: null,
                sha: null,
              },
            ],
          },
        },
      }),
      'utf8',
    )

    process.env.OPENCOVE_RELEASE_NOTES_MANIFEST_PATH = manifestPath
    vi.doMock('electron', () => ({
      app: { isPackaged: false },
    }))

    const { createReleaseNotesService } =
      await import('../../../src/contexts/releaseNotes/infrastructure/main/ReleaseNotesService')
    const service = createReleaseNotesService()

    await expect(
      service.getCurrent({ currentVersion: '0.2.0', language: 'zh-CN' }),
    ).resolves.toMatchObject({
      summary: 'English summary',
      items: [{ summary: 'Fixed the durable release source.' }],
    })

    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns a graceful fallback when no manifest is available', async () => {
    vi.doMock('electron', () => ({
      app: { isPackaged: false },
    }))

    const { createReleaseNotesService } =
      await import('../../../src/contexts/releaseNotes/infrastructure/main/ReleaseNotesService')
    const service = createReleaseNotesService()

    await expect(service.getCurrent({ currentVersion: '9.9.9' })).resolves.toMatchObject({
      provenance: 'fallback',
      items: [],
      compareUrl: 'https://github.com/DeadWaveWave/opencove/blob/main/CHANGELOG.md',
    })
  })
})
