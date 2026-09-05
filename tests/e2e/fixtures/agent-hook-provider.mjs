import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [provider, ...args] = process.argv.slice(2)
const commands = new Map()
if (provider === 'codex') {
  for (const value of args) {
    const event = value.match(/^hooks\.([A-Z][A-Za-z]+)=/u)?.[1]
    if (!event) {
      continue
    }
    const key = process.platform === 'win32' ? 'commandWindows' : 'command'
    const match = value.match(new RegExp(`${key}=("(?:[^"\\\\]|\\\\.)*"|'[^']*')`))
    if (match) {
      commands.set(event, { command: parseString(match[1]) })
    }
  }
} else {
  const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'))
  for (const [event, groups] of Object.entries(settings.hooks)) {
    commands.set(event, groups[0].hooks[0])
  }
}

if (args.includes('app-server')) {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', line => {
    const message = JSON.parse(line)
    if (!message.id) {
      return
    }
    const hooks = [...commands.entries()].map(([event, handler]) => ({
      key: `fixture-${event}`,
      command: handler.command,
      handlerType: 'command',
      isManaged: false,
      source: 'sessionFlags',
      currentHash: 'sha256:fixture',
    }))
    const result = message.method === 'hooks/list' ? { data: [{ hooks }] } : {}
    process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n')
  })
} else {
  if (process.env.ELECTRON_RUN_AS_NODE) {
    throw new Error('Provider inherited Electron control mode')
  }
  await hook('UserPromptSubmit')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  let input = ''
  let pending = Promise.resolve()
  process.stdin.on('data', chunk => {
    for (const byte of chunk) {
      if (byte === 27) {
        process.stdout.write('\r\nESC_RECEIVED\r\n')
      } else if (byte === 3) {
        process.exit(0)
      } else if (byte === 13) {
        const line = input
        input = ''
        pending = pending
          .then(async () => {
            await hook('PreToolUse')
            await hook('PostToolUse')
            await hook('Stop')
            process.stdout.write('\r\nINPUT_OK=' + line + '\r\n')
          })
          .catch(error => {
            process.stderr.write(String(error))
            process.exit(1)
          })
      } else {
        input += String.fromCharCode(byte)
      }
    }
  })
  process.stdout.write('\r\nHOOK_PROVIDER_READY\r\n')
}

function parseString(value) {
  return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1)
}

async function hook(event) {
  const handler = commands.get(event)
  if (!handler) {
    throw new Error('Missing generated hook: ' + event)
  }
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  const shellArgs =
    process.platform === 'win32'
      ? ['-NoProfile', '-Command', handler.command]
      : ['-c', handler.command]
  const child = spawn(handler.args ? handler.command : shell, handler.args ?? shellArgs, {
    env: process.env,
    windowsHide: true,
  })
  const timer = setTimeout(() => child.kill(), 4000)
  let stderr = ''
  child.stderr.on('data', chunk => (stderr += chunk))
  child.stdout.resume()
  child.stdin.on('error', () => undefined)
  child.stdin.end(
    JSON.stringify({
      session_id: 'fixture-hook-session',
      hook_event_name: event,
      cwd: process.cwd(),
      transcript_path: '/tmp/fixture-transcript',
      tool_name: 'Bash',
    }),
  )
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', code =>
        code === 0 ? resolve() : reject(new Error('Hook failed: ' + code + ' ' + stderr)),
      )
    })
  } finally {
    clearTimeout(timer)
  }
}
