import type { AppUpdateChannel } from './update'

export const RELEASE_NOTES_KINDS = ['added', 'fixed', 'changed', 'docs', 'other'] as const

export const RELEASE_NOTES_PROVENANCE = ['curated', 'generated', 'fallback'] as const

export type ReleaseNotesKind = (typeof RELEASE_NOTES_KINDS)[number]
export type ReleaseNotesProvenance = (typeof RELEASE_NOTES_PROVENANCE)[number]

export interface ReleaseNotesItem {
  kind: ReleaseNotesKind
  summary: string
  url: string | null
  prNumber: number | null
  sha: string | null
}

export interface ReleaseNotesManifestLocale {
  summary: string | null
  items: ReleaseNotesItem[]
}

export interface ReleaseNotesManifest {
  schemaVersion: 1
  version: string
  channel: AppUpdateChannel
  publishedAt: string
  provenance: Exclude<ReleaseNotesProvenance, 'fallback'>
  defaultLocale: string
  compareUrl: string | null
  locales: Record<string, ReleaseNotesManifestLocale>
}

export interface GetCurrentReleaseNotesInput {
  currentVersion: string
  language?: string
}

export interface ReleaseNotesCurrentResult {
  currentVersion: string
  channel: AppUpdateChannel
  publishedAt: string | null
  provenance: ReleaseNotesProvenance
  summary: string | null
  compareUrl: string | null
  items: ReleaseNotesItem[]
}
