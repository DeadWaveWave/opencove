import {
  withHomeWorkerConfigLease,
  type HomeWorkerConfigLeaseDependencies,
} from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'

/**
 * Runs the Desktop-started Worker's configuration read under the lease. A release failure is
 * written to stderr and start-up continues: the control surface is already ready by then.
 */
export async function runUnderHomeWorkerConfigLease<T>(
  userDataPath: string,
  operation: () => Promise<T>,
  options: {
    writeStderr?: (text: string) => void
    dependencies?: HomeWorkerConfigLeaseDependencies
  } = {},
): Promise<T> {
  const writeStderr = options.writeStderr ?? ((text: string) => process.stderr.write(text))
  return await withHomeWorkerConfigLease(userDataPath, operation, {
    dependencies: options.dependencies,
    onReleaseError: error => {
      writeStderr(
        `[opencove-worker] Home Worker configuration lease release failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    },
  })
}
