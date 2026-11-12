/** Not corruption: callers must preserve the database rather than replace or repair it. */
export class UnsupportedDatabaseVersionError extends Error {
  constructor(readonly schemaVersion: number) {
    super(
      'This database requires a newer OpenCove version. Upgrade OpenCove or restore a compatible backup to a separate data directory.',
    )
    this.name = 'UnsupportedDatabaseVersionError'
  }
}
