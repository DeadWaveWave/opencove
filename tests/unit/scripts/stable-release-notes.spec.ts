import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')
const stableNotesDir = resolve(rootDir, 'build/release-notes/stable')
const userFacingKinds = new Set(['added', 'changed', 'fixed'])

describe('curated stable release notes', () => {
  it('ships curated notes and a changelog entry for the current stable package version', async () => {
    const { version } = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))
    if (version.includes('-')) {
      return
    }

    const manifest = JSON.parse(await readFile(resolve(stableNotesDir, `v${version}.json`), 'utf8'))
    expect(manifest.version).toBe(version)
    expect(manifest.channel).toBe('stable')
    const changelog = await readFile(resolve(rootDir, 'CHANGELOG.md'), 'utf8')
    expect(changelog).toContain(`## [${version}] - `)
  })

  it('remain concise, localized, and limited to user-facing change kinds', async () => {
    const fileNames = (await readdir(stableNotesDir)).filter(name => name.endsWith('.json'))
    expect(fileNames.length).toBeGreaterThan(0)

    const manifests = await Promise.all(
      fileNames.map(
        async fileName =>
          [
            fileName,
            JSON.parse(await readFile(resolve(stableNotesDir, fileName), 'utf8')),
          ] as const,
      ),
    )
    for (const [fileName, manifest] of manifests) {
      expect(manifest.channel, fileName).toBe('stable')
      expect(manifest.provenance, fileName).toBe('curated')
      expect(fileName, fileName).toBe(`v${manifest.version}.json`)
      expect(manifest.locales?.en, fileName).toBeTruthy()
      expect(manifest.locales?.['zh-CN'], fileName).toBeTruthy()

      for (const [locale, notes] of Object.entries(manifest.locales ?? {})) {
        const items = (notes as { items?: Array<{ kind?: string; summary?: string }> }).items ?? []
        expect(items.length, `${fileName}:${locale}`).toBeGreaterThan(0)
        expect(items.length, `${fileName}:${locale}`).toBeLessThanOrEqual(12)
        for (const item of items) {
          expect(userFacingKinds.has(item.kind ?? ''), `${fileName}:${locale}`).toBe(true)
          expect(item.summary?.trim().length ?? 0, `${fileName}:${locale}`).toBeGreaterThan(0)
        }
      }
    }
  })
})
