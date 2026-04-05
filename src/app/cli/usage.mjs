import { DEFAULT_TIMEOUT_MS } from './constants.mjs'

export function printUsage() {
  process.stdout.write(`OpenCove CLI (dev)\n\n`)
  process.stdout.write(`Usage:\n`)
  process.stdout.write(`  opencove ping [--pretty] [--endpoint <url>] [--token <token>]\n`)
  process.stdout.write(`  opencove project list [--pretty]\n`)
  process.stdout.write(`  opencove space list [--project <id>] [--pretty]\n\n`)
  process.stdout.write(`  opencove space get --space <id> [--pretty]\n\n`)
  process.stdout.write(`  opencove fs read --uri <uri> [--pretty]\n`)
  process.stdout.write(`  opencove fs write --uri <uri> --content <text> [--pretty]\n`)
  process.stdout.write(`  opencove fs stat --uri <uri> [--pretty]\n`)
  process.stdout.write(`  opencove fs ls --uri <uri> [--pretty]\n\n`)
  process.stdout.write(`  opencove worktree list [--project <id>] [--pretty]\n`)
  process.stdout.write(`  opencove worktree create --space <id> [--name <branch>] [--pretty]\n`)
  process.stdout.write(
    `  opencove worktree archive --space <id> [--force] [--delete-branch] [--pretty]\n\n`,
  )
  process.stdout.write(
    `  opencove session run-agent --space <id> --prompt <text> [--provider <id>] [--model <id>] [--pretty]\n`,
  )
  process.stdout.write(`  opencove session get --session <id> [--pretty]\n`)
  process.stdout.write(`  opencove session final --session <id> [--pretty]\n`)
  process.stdout.write(`  opencove session kill --session <id> [--pretty]\n\n`)
  process.stdout.write(
    `  opencove worker start [--hostname <bindHost>] [--advertise-hostname <host>] [--port <port>] [--user-data <dir>] [--token <token>] [--web-ui-password-hash <hash>] [--approve-root <path>]\n`,
  )
  process.stdout.write(
    `  opencove worker status [--endpoint <url>] [--token <token>] [--pretty]\n\n`,
  )
  process.stdout.write(`Global Options:\n`)
  process.stdout.write(`  --pretty                 Pretty-print JSON output\n`)
  process.stdout.write(
    `  --endpoint <url>          Override control surface base URL (for tunnels/remote)\n`,
  )
  process.stdout.write(
    `  --token <token>           Override control surface bearer token (required with --endpoint)\n`,
  )
  process.stdout.write(
    `  --timeout <ms>            Override control surface request timeout (default ${DEFAULT_TIMEOUT_MS}ms)\n\n`,
  )
  process.stdout.write(`Environment:\n`)
  process.stdout.write(`  OPENCOVE_USER_DATA_DIR=/path/to/userData (optional override)\n`)
}
