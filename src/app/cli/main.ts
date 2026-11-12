import { run } from './core/run'
import { createNodeCliIo } from './core/io'
const io = createNodeCliIo()
try {
  process.exitCode = await run(process.argv.slice(2), io)
} finally {
  io.dispose?.()
}
// Node cannot cancel an in-flight process.stdout uv_write with destroy().
// Diagnostics must finish before a blocked-output cancellation closes the process.
if (io.outputCancelled) {
  process.stderr.write('', () => process.exit(Number(process.exitCode ?? 1)))
}
