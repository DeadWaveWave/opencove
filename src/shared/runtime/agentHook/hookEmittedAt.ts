/** Missing/invalid provenance preserves observation compatibility but never proves submission. */
export function parseHookEmittedAt(
  header: string | string[] | undefined,
  now: number,
): number | undefined {
  if (typeof header !== 'string' || !header.trim()) {
    return undefined
  }
  const emitted = Number(header)
  return Number.isFinite(emitted) && emitted <= now + 2000 && emitted >= now - 60000
    ? emitted
    : undefined
}
