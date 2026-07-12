export const PERSISTENCE_STORE_TEST_TIMEOUT_MS = 20_000

export type PersistenceMigrationMockDbState = {
  userVersion: number
  tables: Map<string, string[]>
  openAttempts: number
  workspaceRows: Array<{ id: string; sortOrder: number }>
  failOnFirstOpen?: boolean
}
