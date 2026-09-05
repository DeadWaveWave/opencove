import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createWorkerSpawnEnvironment,
  resolveCliRuntime,
  resolveWorkerRuntimeForStart,
} from './runtime.mjs'

export async function handleRuntimeCommand(args) {
  const runtime = resolveCliRuntime()
  const root = runtime.appRoot ?? runtime.repoRoot
  if (args[0] === 'inspect') {
    const identity = JSON.parse(
      await readFile(resolve(root, 'out/main/runtime-build.json'), 'utf8'),
    )
    if (identity.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(identity.buildId)) {
      throw new Error('Runtime build descriptor is missing or invalid; rebuild this runtime.')
    }
    process.stdout.write(`${JSON.stringify(identity)}\n`)
    return
  }
  if (!['verify', 'prepare'].includes(args[0])) {
    throw new Error('Expected runtime inspect, verify or prepare.')
  }
  const engine = await resolveWorkerRuntimeForStart({ cliRuntime: runtime })
  const child = spawn(
    engine.executablePath,
    [resolve(root, 'out/main/managedRuntime.js'), ...args],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: createWorkerSpawnEnvironment(engine.kind),
    },
  )
  await new Promise((done, reject) => {
    child.once('error', reject)
    child.once('exit', code =>
      code === 0 ? done() : reject(new Error(`Runtime command failed (${code}).`)),
    )
  })
}
