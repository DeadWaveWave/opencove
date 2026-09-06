/** Own the lifetime of this one-shot CLI, including native threads left alive by node-pty. */
export function runManagedRuntimeCommand(command: () => Promise<void>): void {
  const finish = (code: number) => {
    // Flush both pipes before exiting: process.exit() alone can truncate redirected output.
    process.stdout.write('', stdoutError => {
      process.stderr.write('', stderrError => {
        process.exit(stdoutError || stderrError ? 1 : code)
      })
    })
  }
  void Promise.resolve()
    .then(command)
    .then(
      () => finish(0),
      error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        finish(1)
      },
    )
}
