/* eslint-disable no-await-in-loop -- CAS retries and timed race rounds require sequential execution. */
import { submitPersistenceWrite, originalSubmissionError } from './persistenceWriteOutcome'
import { canonicalContent } from './mergeValue'

export class RevisionedSnapshotCache<T> {
  private readonly snapshots = new Map<number, T | null>()
  latest: { revision: number; state: T | null } | null = null

  set(revision: number, state: T | null): void {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('Invalid persistence revision.')
    }
    if (
      this.snapshots.has(revision) &&
      canonicalContent(this.snapshots.get(revision)) !== canonicalContent(state)
    ) {
      throw new Error('Canonical content differs at the same persistence revision.')
    }
    this.snapshots.set(revision, state)
    if (!this.latest || revision > this.latest.revision) {
      this.latest = { revision, state }
    }
    if (this.snapshots.size > 16) {
      this.snapshots.delete(this.snapshots.keys().next().value!)
    }
  }

  invalidate(): void {
    this.snapshots.clear()
    this.latest = null
  }

  get(revision: number): T | null | undefined {
    return this.snapshots.get(revision)
  }
}

export interface RevisionedWriteReceipt {
  revision: number
  corrected?: boolean
}

export function parseRevisionedWriteReceipt(value: unknown): RevisionedWriteReceipt | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const receipt = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(receipt.revision) ||
    (receipt.revision as number) < 0 ||
    (receipt.corrected !== undefined && typeof receipt.corrected !== 'boolean')
  ) {
    return null
  }
  return {
    revision: receipt.revision as number,
    corrected: receipt.corrected as boolean | undefined,
  }
}

let warnedMissingAncestor = false

/** Keep the publisher's ancestor fixed across all conflict retries. */
export async function writeRevisionedSnapshot<T>(options: {
  cache: RevisionedSnapshotCache<T>
  baseRevision?: number | null
  preflight?: boolean
  state: unknown
  read: () => Promise<{ revision: number; state: T | null }>
  write: (state: unknown, revision: number | null) => Promise<RevisionedWriteReceipt>
  normalize: (state: unknown) => T | null
  merge: (latest: T, local: T, ancestor: T | null) => T
  isConflict: (error: unknown) => boolean
}): Promise<{
  revision?: number
  corrected?: boolean
  uncertain?: true
  merged?: true
  state: unknown
}> {
  const { cache } = options
  let base = cache.latest
  const requested = options.baseRevision
  if (typeof requested === 'number' && cache.get(requested) !== undefined) {
    base = { revision: requested, state: cache.get(requested)! }
  } else if (typeof requested === 'number' && !warnedMissingAncestor) {
    warnedMissingAncestor = true
    // eslint-disable-next-line no-console -- Required once-per-process cache eviction diagnostic.
    console.warn('Persistence ancestor is no longer cached; using the latest known snapshot.')
  }
  if (!base && options.preflight !== false) {
    base = await options.read()
    cache.set(base.revision, base.state)
  }
  const ancestor = base?.state ?? null
  let revision = base?.revision ?? null
  let candidate = options.state
  let merged: true | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const receipt = parseRevisionedWriteReceipt(
        await submitPersistenceWrite(() => options.write(candidate, revision)),
      )
      if (!receipt) {
        return { uncertain: true, merged: true, state: candidate }
      }
      const normalized = options.normalize(candidate)
      const requiresRefresh = merged || receipt.corrected !== false || !normalized
      if (!requiresRefresh) {
        try {
          cache.set(receipt.revision, normalized)
        } catch {
          // The mutation succeeded, but conflicting cache ancestry needs a canonical read.
          return { ...receipt, merged: true, state: candidate }
        }
      }
      return { ...receipt, merged: requiresRefresh ? true : undefined, state: candidate }
    } catch (error) {
      const original = originalSubmissionError(error)
      if (!options.isConflict(original)) {
        throw error
      }
      if (attempt === 2) {
        throw original
      }
      const latest = await options.read()
      cache.set(latest.revision, latest.state)
      const local = options.normalize(options.state)
      if (!local) {
        // Rebase cannot repair this candidate; retain the authoritative write failure.
        throw error
      }
      candidate = latest.state ? options.merge(latest.state, local, ancestor) : local
      merged = true
      revision = latest.revision
      if (canonicalContent(candidate) === canonicalContent(latest.state)) {
        return { revision, merged, state: candidate }
      }
    }
  }
  throw new Error('Persistence retry limit exceeded.')
}
