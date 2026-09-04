import type { TerminalGeometryAuthority } from '../../../../shared/contracts/dto'

export function normalizeRemotePtyAuthority(
  role: unknown,
  authorityEpoch: unknown,
): TerminalGeometryAuthority | null {
  if (
    (role !== 'viewer' && role !== 'controller') ||
    typeof authorityEpoch !== 'number' ||
    !Number.isSafeInteger(authorityEpoch) ||
    authorityEpoch < 0
  ) {
    return null
  }
  return { role, epoch: authorityEpoch }
}
