/** A file on the executing host, encoded in argv; runtime wrappers translate only this path. */
export interface CommandFileArgument {
  readonly index: number
  readonly prefix: string
}
