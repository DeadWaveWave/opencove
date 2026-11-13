export function used(): string {
  return 'used'
}

/** @internal */
export function resetUsedForTests(): void {}

export function exportedOnlyForSpec(): string {
  return 'only a spec imports this'
}
