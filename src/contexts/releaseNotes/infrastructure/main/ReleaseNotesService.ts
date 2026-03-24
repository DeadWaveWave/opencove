import { access, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { resolve } from 'node:path'
import { app } from 'electron'
import type {
  GetCurrentReleaseNotesInput,
  ReleaseNotesCurrentResult,
  ReleaseNotesItem,
  ReleaseNotesManifest,
  ReleaseNotesManifestLocale,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

const RELEASE_MANIFEST_OVERRIDE_ENV = 'OPENCOVE_RELEASE_NOTES_MANIFEST_PATH'
const GENERATED_RELEASE_MANIFEST_PATH = ['release', 'release-manifest.json'] as const
const CURATED_STABLE_MANIFEST_PATH = ['build', 'release-notes', 'stable'] as const

export interface ReleaseNotesService {
  getCurrent(input: GetCurrentReleaseNotesInput): Promise<ReleaseNotesCurrentResult>
}

function normalizeVersionTag(version: string): string {
  const normalized = version.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-current currentVersion must be a non-empty string',
    })
  }

  return normalized.startsWith('v') ? normalized : `v${normalized}`
}

function stripVersionPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
}

function isNightlyVersion(version: string): boolean {
  return version.includes('-nightly.')
}

function buildReleaseUrl(version: string): string {
  return `https://github.com/DeadWaveWave/opencove/releases/tag/${encodeURIComponent(
    normalizeVersionTag(version),
  )}`
}

function buildChangelogUrl(): string {
  return 'https://github.com/DeadWaveWave/opencove/blob/main/CHANGELOG.md'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function ensureManifestLocale(value: unknown): ReleaseNotesManifestLocale {
  if (!value || typeof value !== 'object') {
    throw new Error('release notes locale payload must be an object')
  }

  const record = value as Record<string, unknown>
  const summary = normalizeNullableText(record.summary)
  const items = Array.isArray(record.items) ? record.items : []

  const normalizedItems = items
    .map((item): ReleaseNotesItem | null => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const recordItem = item as Record<string, unknown>
      const kind = normalizeNullableText(recordItem.kind)
      const summaryText = normalizeNullableText(recordItem.summary)
      if (
        summaryText === null ||
        kind === null ||
        !['added', 'fixed', 'changed', 'docs', 'other'].includes(kind)
      ) {
        return null
      }

      return {
        kind: kind as ReleaseNotesItem['kind'],
        summary: summaryText,
        url: normalizeNullableText(recordItem.url),
        prNumber: typeof recordItem.prNumber === 'number' ? recordItem.prNumber : null,
        sha: normalizeNullableText(recordItem.sha),
      }
    })
    .filter((item): item is ReleaseNotesItem => item !== null)

  return {
    summary,
    items: normalizedItems,
  }
}

function ensureManifest(value: unknown): ReleaseNotesManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('release notes manifest must be an object')
  }

  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) {
    throw new Error('release notes manifest schemaVersion must be 1')
  }

  const version = normalizeNullableText(record.version)
  const publishedAt = normalizeNullableText(record.publishedAt)
  const defaultLocale = normalizeNullableText(record.defaultLocale)
  const channel = normalizeNullableText(record.channel)
  const provenance = normalizeNullableText(record.provenance)
  const localesValue = record.locales
  if (
    version === null ||
    publishedAt === null ||
    defaultLocale === null ||
    channel === null ||
    provenance === null ||
    (channel !== 'stable' && channel !== 'nightly') ||
    (provenance !== 'curated' && provenance !== 'generated') ||
    !localesValue ||
    typeof localesValue !== 'object'
  ) {
    throw new Error('release notes manifest is missing required fields')
  }

  const locales = Object.fromEntries(
    Object.entries(localesValue as Record<string, unknown>).map(([locale, localeValue]) => [
      locale,
      ensureManifestLocale(localeValue),
    ]),
  )

  if (Object.keys(locales).length === 0) {
    throw new Error('release notes manifest must define at least one locale')
  }

  return {
    schemaVersion: 1,
    version,
    channel,
    publishedAt,
    provenance,
    defaultLocale,
    compareUrl: normalizeNullableText(record.compareUrl),
    locales,
  }
}

function normalizeLanguageCandidates(language: string | undefined): string[] {
  if (!language) {
    return []
  }

  const candidates = [language]
  const separatorIndex = language.indexOf('-')
  if (separatorIndex > 0) {
    candidates.push(language.slice(0, separatorIndex))
  }
  return candidates
}

function selectLocale(
  locales: Record<string, ReleaseNotesManifestLocale>,
  defaultLocale: string,
  language: string | undefined,
): ReleaseNotesManifestLocale {
  for (const candidate of normalizeLanguageCandidates(language)) {
    if (locales[candidate]) {
      return locales[candidate]
    }
  }

  if (locales[defaultLocale]) {
    return locales[defaultLocale]
  }

  return locales[Object.keys(locales)[0]]
}

async function loadManifest(currentVersion: string): Promise<ReleaseNotesManifest | null> {
  const overridePath = process.env[RELEASE_MANIFEST_OVERRIDE_ENV]
  const candidates = [
    overridePath,
    app.isPackaged ? resolve(process.resourcesPath, 'release-manifest.json') : null,
    resolve(process.cwd(), ...GENERATED_RELEASE_MANIFEST_PATH),
    resolve(
      process.cwd(),
      ...CURATED_STABLE_MANIFEST_PATH,
      `${normalizeVersionTag(currentVersion)}.json`,
    ),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  const manifests = await Promise.all(
    candidates.map(async candidate => {
      if (!(await pathExists(candidate))) {
        return null
      }

      try {
        const raw = await readFile(candidate, 'utf8')
        return ensureManifest(JSON.parse(raw))
      } catch {
        return null
      }
    }),
  )

  return (
    manifests.find(
      (manifest): manifest is ReleaseNotesManifest =>
        manifest !== null && stripVersionPrefix(manifest.version) === currentVersion,
    ) ?? null
  )
}

function createFallbackResult(currentVersion: string): ReleaseNotesCurrentResult {
  return {
    currentVersion,
    channel: isNightlyVersion(currentVersion) ? 'nightly' : 'stable',
    publishedAt: null,
    provenance: 'fallback',
    summary: null,
    compareUrl: isNightlyVersion(currentVersion)
      ? buildReleaseUrl(currentVersion)
      : buildChangelogUrl(),
    items: [],
  }
}

export function createReleaseNotesService(): ReleaseNotesService {
  return {
    async getCurrent(input: GetCurrentReleaseNotesInput): Promise<ReleaseNotesCurrentResult> {
      try {
        const manifest = await loadManifest(input.currentVersion)
        if (!manifest) {
          return createFallbackResult(input.currentVersion)
        }

        const localized = selectLocale(manifest.locales, manifest.defaultLocale, input.language)
        return {
          currentVersion: input.currentVersion,
          channel: manifest.channel,
          publishedAt: manifest.publishedAt,
          provenance: manifest.provenance,
          summary: localized.summary,
          compareUrl: manifest.compareUrl ?? buildReleaseUrl(input.currentVersion),
          items: localized.items,
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('currentVersion')) {
          throw error
        }

        return createFallbackResult(input.currentVersion)
      }
    },
  }
}
