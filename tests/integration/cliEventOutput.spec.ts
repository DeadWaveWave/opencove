// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
// Exceed the paused reader plus OS buffers, but stay below the 1 MiB SSE frame limit.
const recordSize = 900_000
const readerHighWaterMark = 256 * 1024
// Real process pipes, with an in-process fetch stand-in: no local listener or provider is needed.
const transport = `
// Observe the real writable without replacing write(), its callback, or drain.
process.on('message', () => process.send({
 writableLength:process.stdout.writableLength,
 writableNeedDrain:process.stdout.writableNeedDrain
}));
// The probe must not keep an otherwise finished CLI alive.
process.channel.unref();
const types=['agent.state_changed','agent.turn_completed'];
const cursor=(seq,selection)=>Buffer.from(JSON.stringify({version:1,epoch:'e',seq,selection})).toString('base64url');
globalThis.fetch=async url=>{
 if(String(url).endsWith('/invoke'))return new Response(JSON.stringify({ok:true,value:{features:{eventStreamV1:true}}}));
 const selection=JSON.parse(new URL(url).searchParams.get('selection'));
 const ready={version:1,type:'stream.ready',cursor:cursor(0,selection),selection,mode:'live'};
 const snapshot={sessionId:'s',nodeId:'x'.repeat(${recordSize}),provider:'codex',state:'idle',blockedReason:null,blockedSummary:null,turn:null,lastTransitionAt:1,source:'launch',quality:'inferred',turnOutcome:null,lastEndedTurn:null};
 const data={version:1,type:'agent.state_changed',cursor:cursor(1,selection),epoch:'e',seq:1,projectId:null,spaceId:null,snapshot,spawnedBy:null,lineageDepth:1,lineageStatus:'root'};
 return new Response(new ReadableStream({start(c){for(const record of [ready,data])c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(record)+'\\n\\n'));c.close()}}),{headers:{'content-type':'text/event-stream'}});
};`
async function fixture(args: string[] = [], checkpoint = false) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-event-pipe-'))
  const preload = join(root, 'transport.mjs')
  await writeFile(preload, transport)
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      resolvePath('out/cli/opencove.mjs'),
      'events',
      '--count',
      '1',
      ...(checkpoint ? ['--cursor-file', join(root, 'cursor')] : []),
      ...args,
    ],
    {
      env: {
        ...process.env,
        OPENCOVE_ENV: '0',
        OPENCOVE_CONTROL_URL: 'http://fixture',
        OPENCOVE_CONTROL_TOKEN: 'test-secret',
        OPENCOVE_USER_DATA_DIR: root,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  )
  // read(size) raises this reader's highWaterMark before any child output arrives.
  // With the old 200 KB record this deterministically allowed exit 0 while paused.
  child.stdout!.read(readerHighWaterMark)
  let stderr = ''
  child.stderr!.on('data', chunk => {
    stderr += chunk
  })
  const closed = new Promise<number | null>((done, reject) => {
    child.once('error', reject)
    child.once('close', done)
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  return {
    child,
    async expectBlocked() {
      const state = await new Promise<unknown>((done, reject) => {
        const fail = (error: Error) => {
          child.off('message', onMessage)
          child.off('exit', onExit)
          reject(error)
        }
        const onExit = () => fail(new Error(`CLI exited before output probe: ${stderr}`))
        const onMessage = (message: unknown) => {
          child.off('exit', onExit)
          done(message)
        }
        child.once('message', onMessage)
        child.once('exit', onExit)
        child.send('output-state', error => {
          if (error) {
            fail(error)
          }
        })
      })
      expect(state).toMatchObject({ writableNeedDrain: true })
      expect((state as { writableLength: number }).writableLength).toBeGreaterThan(0)
      expect(child.exitCode).toBeNull()
    },
    cursor: async () =>
      JSON.parse(
        Buffer.from((await readFile(join(root, 'cursor'), 'utf8')).trim(), 'base64url').toString(),
      ),
    closed,
    err: () => stderr,
    async cleanup() {
      clearTimeout(timeout)
      child.stdout!.resume()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await closed
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}
it('flushes the last count record before successful process exit', async () => {
  const f = await fixture([], true)
  try {
    // A slow consumer must be able to resume without losing the final record.
    await expect
      .poll(() => f.child.stdout!.readableLength)
      .toBeGreaterThanOrEqual(readerHighWaterMark)
    await f.expectBlocked()
    expect((await f.cursor()).seq).toBe(0)
    let stdout = ''
    f.child.stdout!.on('data', chunk => {
      stdout += chunk
    })
    expect(await f.closed, f.err()).toBe(0)
    expect(stdout.endsWith('\n')).toBe(true)
    const records = stdout
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(records.map(r => r.type)).toEqual(['stream.ready', 'agent.state_changed'])
    expect(records[1].snapshot.nodeId).toHaveLength(recordSize)
    expect((await f.cursor()).seq).toBe(1)
  } finally {
    await f.cleanup()
  }
})
it.each(['SIGINT', 'SIGTERM'] as const)(
  'cancels a real blocked stdout pipe on %s',
  async signal => {
    if (process.platform === 'win32') {
      return
    } // POSIX signal contract; Electron suite labels the platform boundary.
    const f = await fixture([], true)
    f.child.once('exit', () => f.child.stdout!.resume())
    try {
      let prefix = ''
      await new Promise<void>(done =>
        f.child.stdout!.once('data', chunk => {
          prefix += chunk
          f.child.stdout!.pause()
          done()
        }),
      )
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(f.child.exitCode).toBeNull()
      await f.expectBlocked()
      expect(prefix).toContain('stream.ready')
      expect((await f.cursor()).seq).toBe(0)
      f.child.kill(signal)
      expect(await f.closed, f.err()).toBe(signal === 'SIGINT' ? 130 : 143)
      expect((await f.cursor()).seq).toBe(0)
    } finally {
      await f.cleanup()
    }
  },
)
it('times out with the previous complete cursor while a final record is blocked', async () => {
  const f = await fixture(['--timeout', '250ms'], true)
  try {
    f.child.stdout!.pause()
    // Drain only after exit so a full pipe cannot accidentally unblock the last record.
    f.child.once('exit', () => f.child.stdout!.resume())
    expect(await f.closed, f.err()).toBe(124)
    expect((await f.cursor()).seq).toBe(0)
    expect(JSON.parse(f.err()).error.details.cursor).toBeTruthy()
  } finally {
    await f.cleanup()
  }
})
it('treats a real pipe closing halfway through a record as consumer termination', async () => {
  const f = await fixture([], true)
  try {
    await new Promise<void>(done =>
      f.child.stdout!.once('data', () => {
        f.child.stdout!.destroy()
        done()
      }),
    )
    expect(await f.closed, f.err()).toBe(0)
  } finally {
    await f.cleanup()
  }
})
