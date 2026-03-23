export const RELEASE_NOTES_KINDS = ['added', 'fixed', 'changed', 'docs', 'other'] as const

export type ReleaseNotesKind = (typeof RELEASE_NOTES_KINDS)[number]

export interface ReleaseNotesItem {
  kind: ReleaseNotesKind
  summary: string
  url: string | null
  prNumber: number | null
  sha: string | null
}

export interface GetReleaseNotesRangeInput {
  fromVersion: string
  toVersion: string
  limit?: number
}

export interface GetReleaseNotesAutoRangeInput {
  toVersion: string
  limit?: number
}

export interface ReleaseNotesRangeResult {
  fromVersion: string
  toVersion: string
  compareUrl: string | null
  generatedAt: string
  truncated: boolean
  items: ReleaseNotesItem[]
}
