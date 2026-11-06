import { run } from './core/run'
import { createNodeCliIo } from './core/io'
import { legacyAdapter } from './legacy'
const io = createNodeCliIo()
io.legacy = async argv => {
  io.dispose?.()
  return legacyAdapter(argv)
}
try {
  process.exitCode = await run(process.argv.slice(2), io)
} finally {
  io.dispose?.()
}
