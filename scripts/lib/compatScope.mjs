// Which files `compat:check` scans. The naming check shares this list: it leaves `cove:m0:` to the
// compatibility check only in files that check actually reads.

export const ORACLE_DIRECTORY = 'tests/support/controlSurfaceLegacyOracles/'
const PARITY_SPEC_PATTERN = /^tests\/unit\/contexts\/controlSurface\.[A-Za-z.]*Parity\.spec\.ts$/

export function isOracleFile(path) {
  return path.startsWith(ORACLE_DIRECTORY) && /\.tsx?$/.test(path)
}

// The parity specs compare the frozen oracles with the schemas, so they live and die with them.
export function isParitySpecFile(path) {
  return PARITY_SPEC_PATTERN.test(path)
}

export function isCompatScannedFile(path) {
  if (isOracleFile(path) || isParitySpecFile(path)) {
    return true
  }
  return (
    path.startsWith('src/') &&
    /\.tsx?$/.test(path) &&
    !/\.d\.ts$/.test(path) &&
    !/\.(?:spec|test)\.tsx?$/.test(path)
  )
}
