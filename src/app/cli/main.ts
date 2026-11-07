import { run } from './core/run'
import { createNodeCliIo } from './core/io'
const io = createNodeCliIo()
try {
  process.exitCode = await run(process.argv.slice(2), io)
} finally {
  io.dispose?.()
}
