import { spawn } from 'node:child_process'

const input = await new Promise((resolveInput, reject) => {
  const chunks = []
  process.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)))
  process.stdin.once('error', reject)
  process.stdin.once('end', () => {
    try {
      resolveInput(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch (error) {
      reject(error)
    }
  })
})

const child = spawn(input.executable, ['app-server'], {
  env: { ...process.env, CODEX_HOME: input.runtimeHome },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

let stderr = ''
child.stderr.on('data', chunk => {
  stderr = `${stderr}${String(chunk)}`.slice(-4000)
})

let buffer = ''
const waiters = new Map()
child.stdout.on('data', chunk => {
  buffer += String(chunk)
  let newline = buffer.indexOf('\n')
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      try {
        const message = JSON.parse(line)
        if (message && typeof message.id === 'number') {
          waiters.get(message.id)?.(message)
          waiters.delete(message.id)
        }
      } catch {
        // Ignore non-protocol diagnostics.
      }
    }
    newline = buffer.indexOf('\n')
  }
})

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

function request(id, method, params) {
  return new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id)
      reject(new Error(`${method} timed out`))
    }, 6000)
    timer.unref()
    waiters.set(id, message => {
      clearTimeout(timer)
      if (message.error) {
        reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
        return
      }
      resolveResponse(message.result)
    })
    send({ id, method, params })
  })
}

function listHooks(result) {
  return Array.isArray(result?.data)
    ? result.data.flatMap(item => (Array.isArray(item?.hooks) ? item.hooks : []))
    : []
}

function managedHooks(result) {
  const expectedKeys = new Set(input.entries.map(entry => entry.key))
  const expectedCommands = new Set(input.entries.map(entry => entry.command))
  return listHooks(result).filter(
    hook => expectedKeys.has(hook?.key) && expectedCommands.has(hook?.command),
  )
}

let completed = false
const hardExit = setTimeout(() => {
  if (!completed) {
    child.kill('SIGKILL')
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'trust grant hard timeout' })}\n`)
    process.exit(0)
  }
}, 15000)
hardExit.unref()

try {
  await request(1, 'initialize', {
    clientInfo: { name: 'opencove_desktop', title: 'OpenCove', version: '0.0.0' },
  })
  send({ method: 'initialized', params: {} })
  const firstResult = await request(2, 'hooks/list', { cwds: [input.runtimeHome] })
  const first = managedHooks(firstResult)
  if (first.length !== input.entries.length) {
    throw new Error(
      `hooks/list did not return every managed hook (${first.length}/${input.entries.length}); observed=${JSON.stringify(
        listHooks(firstResult).map(hook => ({ key: hook?.key, command: hook?.command })),
      )}`,
    )
  }
  const hashes = Object.fromEntries(first.map(hook => [hook.key, hook.currentHash]))
  const untrusted = first.filter(hook => hook.trustStatus !== 'trusted')
  if (untrusted.length > 0) {
    await request(3, 'config/batchWrite', {
      edits: [
        {
          keyPath: 'hooks.state',
          value: Object.fromEntries(
            untrusted.map(hook => [hook.key, { trusted_hash: hook.currentHash }]),
          ),
          mergeStrategy: 'upsert',
        },
      ],
      reloadUserConfig: true,
    })
  }
  const verified = managedHooks(await request(4, 'hooks/list', { cwds: [input.runtimeHome] }))
  if (
    verified.length !== input.entries.length ||
    verified.some(hook => hook.trustStatus !== 'trusted' || hashes[hook.key] !== hook.currentHash)
  ) {
    throw new Error('managed hook trust verification failed')
  }
  completed = true
  clearTimeout(hardExit)
  child.stdin.end()
  child.kill()
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      trustedHashes: hashes,
      hooks: verified.map(hook => ({
        key: hook.key,
        currentHash: hook.currentHash,
        trustStatus: hook.trustStatus,
        command: hook.command,
      })),
    })}\n`,
  )
} catch (error) {
  completed = true
  clearTimeout(hardExit)
  child.stdin.end()
  child.kill('SIGKILL')
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), stderr })}\n`,
  )
}
