import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { WORKER_PARENT_SHUTDOWN } from '../../../shared/runtime/workerParentShutdown'
import { LOCAL_WORKER_STOP_TIMEOUT_MS } from '../../../shared/runtime/controlSurfaceShutdown'
import { defineCommand, type CommandContext } from '../core/command'
import { CliError, usage } from '../core/errors'
import {
  createWorkerSpawnEnvironment,
  resolveCliAppVersion,
  resolveCliRuntime,
  resolveWorkerRuntimeForStart,
} from '../runtime.mjs'
import {
  getWorkerLifecycleStatus,
  stopWorkerLifecycle,
  WorkerLifecycleError,
} from '../workerLifecycle.mjs'
import { option } from './remote'

async function childCommand(ctx: CommandContext, worker: boolean, action: string) {
  const runtime = resolveCliRuntime()
  const script = worker
    ? runtime.workerScriptPath
    : resolve(runtime.appRoot ?? runtime.repoRoot, 'out/main/managedRuntime.js')
  if (!existsSync(script)) {
    throw new CliError(
      'runtime.missing',
      1,
      `Runtime entry is missing: ${script}`,
      'Build or reinstall the runtime.',
    )
  }
  const appVersion = resolveCliAppVersion(runtime)
  if (worker && runtime.kind === 'standalone' && appVersion === null) {
    throw new CliError(
      'runtime.invalid',
      1,
      'Standalone runtime version is missing',
      'Reinstall the runtime.',
    )
  }
  const engine = await resolveWorkerRuntimeForStart({ cliRuntime: runtime })
  const args = worker
    ? ['--started-by=cli', ...(appVersion ? [`--app-version=${appVersion}`] : [])]
    : [action]
  if (worker) {
    for (const key of [
      'hostname',
      'advertise-hostname',
      'port',
      'user-data',
      'token',
      'web-ui-password',
      'web-ui-password-hash',
      'approve-root',
    ]) {
      const value = ctx.options[key]
      if (value !== undefined) {
        for (const item of Array.isArray(value) ? value : [value]) {
          args.push(`--${key}=${item}`)
        }
      }
    }
  }
  const input = !worker && action === 'prepare' ? await ctx.io.readStdinText() : undefined
  if (ctx.io.signal?.aborted) {
    throw new CliError('cli.interrupted', 130, 'Interrupted')
  }
  const cooperative = worker && process.platform === 'win32'
  const streamProgress = ctx.options['stream-progress'] === true
  const child = spawn(engine.executablePath, [script, ...args], {
    stdio: cooperative ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: createWorkerSpawnEnvironment(engine.kind, ctx.io.env, {
      disableElectronSandbox:
        process.platform === 'linux' &&
        (ctx.io.env.CI === '1' ||
          ctx.io.env.CI?.toLowerCase() === 'true' ||
          process.getuid?.() === 0),
    }),
  })
  let output = ''
  // Retain only a bounded tail; plain child diagnostics must not corrupt JSON stderr.
  let diagnostics = ''
  let diagnosticsTruncated = false
  const diagnostic = (text: string) => {
    const combined = diagnostics + text
    diagnosticsTruncated ||= combined.length > 16_384
    diagnostics = combined.slice(-16_384)
    if (streamProgress || (ctx.io.stderr.isTTY && ctx.options.output !== 'json')) {
      ctx.io.stderr.write(text)
    }
  }
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (text: string) => {
    if (worker || action === 'prepare') {
      diagnostic(text)
    } else {
      output += text
    }
  })
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', diagnostic)
  child.stdin!.on('error', () => {})
  child.stdin!.end(input)
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const abort = () => {
    if (cooperative) {
      // Never use kill(SIGTERM) as a cooperative request on Windows.
      // A broken IPC channel still gets the full deadline before force termination.
      try {
        child.send({ type: WORKER_PARENT_SHUTDOWN }, () => {})
      } catch {
        /* Wait for deadline. */
      }
    } else {
      child.kill('SIGTERM')
    }
    // Give the Worker shutdown owner its complete drain and watchdog budget.
    killTimer = setTimeout(
      () => child.kill('SIGKILL'),
      worker ? LOCAL_WORKER_STOP_TIMEOUT_MS : 5000,
    )
  }
  ctx.io.signal?.addEventListener('abort', abort, { once: true })
  try {
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject)
      child.once('close', done)
    })
    if (ctx.io.signal?.aborted) {
      throw new CliError('cli.interrupted', 130, 'Interrupted', undefined, {
        diagnostics,
        diagnosticsTruncated,
      })
    }
    if (code !== 0) {
      throw new CliError(
        'runtime.failed',
        1,
        `Runtime command failed (${code})`,
        'Inspect error.details.diagnostics for runtime diagnostics.',
        { diagnostics, diagnosticsTruncated },
      )
    }
    return worker
      ? { status: 'stopped' }
      : action === 'prepare'
        ? { status: 'prepared' }
        : JSON.parse(output)
  } finally {
    if (killTimer) {
      clearTimeout(killTimer)
    }
    ctx.io.signal?.removeEventListener('abort', abort)
  }
}
export const lifecycleCommands = [
  defineCommand({
    path: ['worker', 'start'],
    mutation: true,
    summary: 'Start a local worker in the foreground',
    connect: false,
    options: {
      'stream-progress': option(
        'Stream raw diagnostics to stderr instead of a single JSON error document',
        '',
        false,
        'boolean',
      ),
      hostname: option('Listen on this host', 'host'),
      'advertise-hostname': option('Advertise this reachable host', 'host'),
      port: option('Listen on this port', 'port', false, 'number'),
      'web-ui-password': option('Protect the web UI with this password', 'password'),
      'web-ui-password-hash': option('Use this web UI password hash', 'hash'),
      'approve-root': {
        ...option('Approve a filesystem root for the worker', 'path'),
        multiple: true,
      },
    },
    execute: ctx => childCommand(ctx, true, 'start'),
  }),
  ...(['status', 'stop'] as const).map(name =>
    defineCommand({
      path: ['worker', name],
      mutation: name === 'stop',
      summary: name === 'status' ? 'Inspect local worker status' : 'Stop a local worker',
      connect: false,
      options:
        name === 'status'
          ? { all: option('Include stopped worker records', '', false, 'boolean') }
          : {
              pid: option('Stop this worker process', 'pid', false, 'number'),
              force: option('Override ownership and reachability checks', '', false, 'boolean'),
            },
      async execute({ options: o }) {
        if (o.endpoint !== undefined) {
          usage(
            `worker ${name} only supports local workers`,
            'Use --user-data <dir> to select a local profile.',
          )
        }
        const options = {
          userData: o['user-data'],
          timeoutMs: o.timeout,
          all: o.all,
          pid: o.pid,
          force: o.force,
        }
        try {
          return await (name === 'status'
            ? getWorkerLifecycleStatus(options)
            : stopWorkerLifecycle(options))
        } catch (error) {
          if (error instanceof Error && error instanceof WorkerLifecycleError) {
            throw new CliError(
              'worker.lifecycle',
              2,
              error.message,
              `Run "opencove worker ${name} --help" to see its options.`,
            )
          }
          throw error
        }
      },
    }),
  ),
  ...(['inspect', 'verify', 'prepare'] as const).map(name =>
    defineCommand({
      path: ['runtime', name],
      mutation: name === 'prepare',
      summary: {
        inspect: 'Inspect the runtime build',
        verify: 'Verify the runtime environment',
        prepare: 'Prepare a managed runtime deployment',
      }[name],
      connect: false,
      options:
        name === 'inspect'
          ? {}
          : {
              'stream-progress': option(
                'Stream raw progress and diagnostics to stderr instead of a single JSON error document',
                '',
                false,
                'boolean',
              ),
            },
      async execute(ctx) {
        if (name !== 'inspect') {
          return childCommand(ctx, false, name)
        }
        const runtime = resolveCliRuntime()
        const identity = JSON.parse(
          await ctx.io.readTextFile(
            resolve(runtime.appRoot ?? runtime.repoRoot, 'out/main/runtime-build.json'),
          ),
        )
        if (identity.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(identity.buildId)) {
          throw new CliError(
            'runtime.invalid',
            1,
            'Runtime build descriptor is missing or invalid',
            'Rebuild this runtime.',
          )
        }
        return identity
      },
    }),
  ),
]
