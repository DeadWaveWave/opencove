export function used(): string {
  return 'used'
}

/** @internal */
export function resetUsedForTests(): void {}

export function exportedOnlyForSpec(): string {
  return 'only a spec imports this'
}

/** @public */
export function publicButUnused(): string {
  return 'knip never reports a @public export; the wrapper rejects the tag'
}
