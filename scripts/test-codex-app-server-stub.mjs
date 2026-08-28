#!/usr/bin/env node

import readline from 'node:readline'

function resolveHookCommand(args) {
  for (const argument of args) {
    if (!argument.startsWith('hooks.') || !argument.includes('command=')) {
      continue
    }
    const match = argument.match(/,command=("(?:\\.|[^"\\])*")/)
    if (match?.[1]) {
      return JSON.parse(match[1])
    }
  }
  return null
}

const hookCommand = resolveHookCommand(process.argv.slice(2))
if (!hookCommand) {
  process.stderr.write('test Codex app-server could not resolve its injected hook command\n')
  process.exit(2)
}

const lines = readline.createInterface({ input: process.stdin })
lines.on('line', line => {
  const request = JSON.parse(line)
  if (request.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`)
    return
  }
  if (request.method === 'hooks/list') {
    process.stdout.write(
      `${JSON.stringify({
        id: request.id,
        result: {
          data: [
            {
              hooks: [
                {
                  command: hookCommand,
                  handlerType: 'command',
                  isManaged: false,
                  source: 'sessionFlags',
                  currentHash: 'sha256:opencove-e2e',
                  key: 'opencove-e2e-terminal-shim',
                },
              ],
            },
          ],
        },
      })}\n`,
    )
  }
})
