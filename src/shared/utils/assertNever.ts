function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Exhaustiveness guard for closed unions. Calling it with a value that is not `never` is a compile
 * error, so a switch over a variant that ends in `default: return assertNever(x)` fails `tsc` as soon
 * as a member is added without a case. At runtime it throws instead of silently falling through.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected variant: ${describeValue(value)}`)
}
