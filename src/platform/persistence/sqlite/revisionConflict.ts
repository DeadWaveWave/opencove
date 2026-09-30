export class PersistenceRevisionConflict extends Error {
  constructor(expected: number, actual: number) {
    super(`App state revision conflict (expected=${expected}, current=${actual}).`)
    this.name = 'PersistenceRevisionConflict'
  }
}
