// Executed by the real coordinating Claude's Bash tool in its isolated workspace.
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const { Readable } = require('node:stream')
const { createInterface } = require('node:readline')
const { writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')
async function main() {
  const upstream = process.env.OPENCOVE_CONTROL_URL
  const operations = []
  const proxy = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    if (req.url === '/invoke') {
      operations.push(JSON.parse(body).id)
    }
    const abort = new AbortController()
    res.once('close', () => abort.abort())
    try {
      const response = await fetch(upstream + req.url, {
        method: req.method,
        headers: { authorization: req.headers.authorization, 'content-type': 'application/json' },
        ...(req.method === 'POST' ? { body } : {}),
        signal: abort.signal,
      })
      res.writeHead(response.status, Object.fromEntries(response.headers))
      Readable.fromWeb(response.body)
        .on('error', () => res.destroy())
        .pipe(res)
    } catch {
      res.destroy()
    }
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const env = { ...process.env, OPENCOVE_CONTROL_URL: `http://127.0.0.1:${proxy.address().port}` }
  const children = new Set()
  const start = args => {
    const child = spawn(process.execPath, [process.env.OPENCOVE_CLI, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.add(child)
    const closed = new Promise(resolve =>
      child.once('close', code => {
        children.delete(child)
        resolve(code)
      }),
    )
    let stderr = ''
    child.stderr.on('data', data => {
      stderr += data
    })
    return { child, closed, error: () => stderr }
  }
  const cli = async args => {
    const p = start(args)
    let text = ''
    p.child.stdout.on('data', chunk => {
      text += chunk
    })
    assert.equal(await p.closed, 0, p.error())
    return JSON.parse(text)
  }
  const records = []
  const watch = args => {
    const p = start(['events', ...args])
    const waiters = []
    const lines = createInterface({ input: p.child.stdout })
    const local = []
    lines.on('line', line => {
      const record = JSON.parse(line)
      local.push(record)
      records.push(record)
      for (const waiter of [...waiters]) {
        if (waiter.predicate(record)) {
          waiter.resolve(record)
        }
      }
    })
    return {
      ...p,
      wait(predicate) {
        const found = local.find(predicate)
        if (found) {
          return Promise.resolve(found)
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Expected event not received')), 110_000)
          waiters.push({
            predicate,
            resolve(value) {
              clearTimeout(timer)
              resolve(value)
            },
          })
        })
      },
    }
  }
  const watchdog = setTimeout(() => {
    for (const child of children) {
      child.kill('SIGTERM')
    }
  }, 115_000)
  try {
    const first = watch([
      '--spawned-by',
      '@self',
      '--until',
      'agent.turn_completed',
      '--timeout',
      '2m',
    ])
    await first.wait(record => record.type === 'stream.ready')
    const created = await cli([
      'node',
      'create',
      'agent',
      '--space',
      '@self',
      '--provider',
      'claude-code',
      '--prompt',
      'SLOW_TEXT Reply with a delayed acknowledgement.',
    ])
    const bound = await first.wait(record => record.snapshot?.nodeId === created.node.id)
    first.child.kill('SIGTERM')
    assert.equal(await first.closed, 143, first.error())
    // The mock API delays text for six seconds. Publish completion while disconnected.
    await new Promise(resolve => setTimeout(resolve, 7500))
    const resumed = watch([
      '--after',
      bound.cursor,
      '--until',
      'agent.turn_completed',
      '--timeout',
      '2m',
    ])
    const completed = await resumed.wait(record => record.type === 'agent.turn_completed')
    assert.equal(await resumed.closed, 0, resumed.error())
    assert.equal(completed.snapshot.nodeId, created.node.id)
    assert.equal(completed.snapshot.sessionId, created.node.sessionId)
    const reply = await cli([
      'agent',
      'read',
      '--node',
      created.node.id,
      '--turn',
      completed.endedTurn.id,
      '-o',
      'json',
    ])
    assert.equal(reply.nodeId, completed.snapshot.nodeId)
    assert.equal(reply.sessionId, completed.snapshot.sessionId)
    assert.equal(reply.turnId, completed.endedTurn.id)
    assert.equal(reply.outcome, completed.snapshot.lastEndedTurn.outcome)
    assert.equal(reply.message, 'DONE-TEXT')
    assert.equal(operations.filter(id => id === 'agent.list' || id === 'agent.get').length, 0)
    writeFileSync(
      process.argv[2],
      JSON.stringify({ records, operations, reply, created, exits: [143, 0] }),
    )
  } finally {
    clearTimeout(watchdog)
    for (const child of children) {
      child.kill('SIGTERM')
    }
    proxy.closeAllConnections()
    proxy.close()
  }
}
main().catch(error => {
  process.stderr.write(String(error) + '\n')
  process.exitCode = 1
})
