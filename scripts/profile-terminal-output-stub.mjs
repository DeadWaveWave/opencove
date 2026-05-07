#!/usr/bin/env node

const terminalIndex = Number.parseInt(process.argv[2] ?? '0', 10)
const intervalMs = Math.max(16, Number.parseInt(process.argv[3] ?? '100', 10))
const payloadBytes = Math.max(0, Number.parseInt(process.argv[4] ?? '160', 10))
const maxDurationMs = Math.max(1_000, Number.parseInt(process.argv[5] ?? '120000', 10))
const label = `opencove-profile-terminal-output-stub-${terminalIndex}`
const startedAt = Date.now()
let tick = 0

const filler = 'x'.repeat(payloadBytes)

process.stdout.write(`[${label}] start interval=${intervalMs} payload=${payloadBytes}\n`)

const timer = setInterval(() => {
  tick += 1
  const elapsedMs = Date.now() - startedAt
  const color = terminalIndex % 2 === 0 ? 32 : 36
  process.stdout.write(
    `\u001b[${color}m[${label}] tick=${tick} elapsedMs=${elapsedMs}\u001b[0m ${filler}\n`,
  )
}, intervalMs)

setTimeout(() => {
  clearInterval(timer)
  process.stdout.write(`[${label}] complete tick=${tick}\n`)
}, maxDurationMs)

process.on('SIGTERM', () => {
  clearInterval(timer)
  process.exit(0)
})
