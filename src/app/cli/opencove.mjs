#!/usr/bin/env node

import { startWorker } from './workerStart.mjs'
import { handleRuntimeCommand } from './runtimeCommand.mjs'

import { readFlagValue, requireFlagValue, resolveTimeoutMs, stripGlobalOptions } from './args.mjs'
import { resolveConnectionInfo, resolveWorkerConnectionInfo } from './connection.mjs'
import { invokeAndPrint, invokeControlSurface } from './invoke.mjs'
import { printUsage } from './usage.mjs'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from './constants.mjs'
import { tryHandleMultiEndpointCommands } from './commands/multiEndpoint.mjs'
import { tryHandleNodeControlCommands } from './commands/nodeControl.mjs'
import {
  getWorkerLifecycleStatus,
  printWorkerLifecycleResult,
  stopWorkerLifecycle,
  WorkerLifecycleError,
} from './workerLifecycle.mjs'

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'unknown error'
}

async function main() {
  const argv = process.argv.slice(2)
  const wantsHelp = argv.includes('--help') || argv.includes('-h')
  const pretty = argv.includes('--pretty')
  const endpoint = readFlagValue(argv, '--endpoint')
  const token = readFlagValue(argv, '--token')

  const timeoutMs = resolveTimeoutMs(argv)
  const args = stripGlobalOptions(argv)
  const command = args[0] || ''

  if (wantsHelp || command.length === 0) {
    printUsage()
    process.exit(command.length === 0 ? 2 : 0)
  }

  if (command === 'runtime') {
    await handleRuntimeCommand(args.slice(1))
    return
  }

  if (command === 'worker' && args[1] === 'start') {
    await startWorker(argv)
    return
  }

  if (command === 'worker' && args[1] === 'status' && !endpoint) {
    const status = await getWorkerLifecycleStatus({
      all: args.includes('--all'),
      userData: readFlagValue(args, '--user-data'),
      timeoutMs,
    })
    printWorkerLifecycleResult(status, pretty)
    return
  }

  if (command === 'worker' && args[1] === 'stop') {
    if (endpoint) {
      process.stderr.write('[opencove] worker stop only supports local workers.\n')
      process.exit(2)
    }

    try {
      const result = await stopWorkerLifecycle({
        userData: readFlagValue(args, '--user-data'),
        pid: readFlagValue(args, '--pid'),
        force: args.includes('--force'),
        timeoutMs,
      })
      printWorkerLifecycleResult(result, pretty)
      return
    } catch (error) {
      if (error instanceof WorkerLifecycleError) {
        process.stderr.write(`${error.message}\n`)
        process.exit(2)
      }

      throw error
    }
  }

  const isWorkerStatusCommand = command === 'worker' && args[1] === 'status'
  const capabilitiesRequest = { kind: 'query', id: 'system.capabilities', payload: null }

  const connection = endpoint
    ? (() => {
        if (!token) {
          process.stderr.write('[opencove] missing required flag: --token <token>\n')
          process.exit(2)
        }

        let parsed
        try {
          parsed = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`)
        } catch {
          process.stderr.write(`[opencove] invalid endpoint: ${endpoint}\n`)
          process.exit(2)
        }

        const port = Number(parsed.port)
        if (!Number.isFinite(port) || port <= 0) {
          process.stderr.write(`[opencove] endpoint must include port: ${endpoint}\n`)
          process.exit(2)
        }

        return { hostname: parsed.hostname, port, token }
      })()
    : await (isWorkerStatusCommand ? resolveWorkerConnectionInfo() : resolveConnectionInfo())

  if (!connection) {
    process.stderr.write(
      isWorkerStatusCommand
        ? '[opencove] worker control surface is not running (no valid connection info found).\n'
        : '[opencove] control surface is not running (no valid connection info found).\n',
    )
    process.exit(2)
  }

  try {
    const { result } = await invokeControlSurface(connection, capabilitiesRequest, { timeoutMs })
    if (!result || result.ok !== true) {
      process.stderr.write('[opencove] incompatible worker: missing system.capabilities.\n')
      process.exit(2)
    }

    const value = result.value
    const protocolVersion =
      value && typeof value === 'object' && !Array.isArray(value) ? value.protocolVersion : null

    if (protocolVersion !== CONTROL_SURFACE_PROTOCOL_VERSION) {
      process.stderr.write(
        `[opencove] incompatible protocol (cli=${CONTROL_SURFACE_PROTOCOL_VERSION}, worker=${protocolVersion ?? 'unknown'}).\n`,
      )
      process.exit(2)
    }
  } catch (error) {
    process.stderr.write(`[opencove] capabilities check failed: ${toErrorMessage(error)}\n`)
    process.exit(2)
  }

  if (command === 'ping') {
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'system.ping', payload: null },
      { pretty, timeoutMs },
    )

    return
  }

  if (
    await tryHandleMultiEndpointCommands({
      command,
      args,
      connection,
      pretty,
      timeoutMs,
    })
  ) {
    return
  }

  if (
    await tryHandleNodeControlCommands({
      command,
      args,
      connection,
      pretty,
      timeoutMs,
    })
  ) {
    return
  }

  if (isWorkerStatusCommand) {
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'system.ping', payload: null },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'project' && args[1] === 'list') {
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'project.list', payload: null },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'space' && args[1] === 'list') {
    const projectId = readFlagValue(args, '--project')
    const payload = projectId ? { projectId } : null

    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'space.list', payload },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'space' && args[1] === 'get') {
    const spaceId = requireFlagValue(args, '--space')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'space.get', payload: { spaceId } },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'fs' && args[1] === 'read') {
    const uri = requireFlagValue(args, '--uri')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'filesystem.readFileText', payload: { uri } },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'fs' && args[1] === 'write') {
    const uri = requireFlagValue(args, '--uri')
    const content = requireFlagValue(args, '--content')
    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'filesystem.writeFileText', payload: { uri, content } },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'fs' && args[1] === 'stat') {
    const uri = requireFlagValue(args, '--uri')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'filesystem.stat', payload: { uri } },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'fs' && args[1] === 'ls') {
    const uri = requireFlagValue(args, '--uri')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'filesystem.readDirectory', payload: { uri } },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'worktree' && args[1] === 'list') {
    const projectId = readFlagValue(args, '--project')
    const payload = projectId ? { projectId } : null

    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'worktree.list', payload },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'worktree' && args[1] === 'create') {
    const spaceId = requireFlagValue(args, '--space')
    const name = readFlagValue(args, '--name')
    const payload = name ? { spaceId, name } : { spaceId }

    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'worktree.create', payload },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'worktree' && args[1] === 'archive') {
    const spaceId = requireFlagValue(args, '--space')
    const force = args.includes('--force')
    const deleteBranch = args.includes('--delete-branch')

    const payload = {
      spaceId,
      ...(force ? { force: true } : {}),
      ...(deleteBranch ? { deleteBranch: true } : {}),
    }

    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'worktree.archive', payload },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'session' && args[1] === 'run-agent') {
    const spaceId = requireFlagValue(args, '--space')
    const prompt = requireFlagValue(args, '--prompt')
    const provider = readFlagValue(args, '--provider')
    const model = readFlagValue(args, '--model')

    await invokeAndPrint(
      connection,
      {
        kind: 'command',
        id: 'session.launchAgent',
        payload: {
          spaceId,
          prompt,
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
        },
      },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'session' && args[1] === 'get') {
    const sessionId = requireFlagValue(args, '--session')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'session.get', payload: { sessionId } },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'session' && args[1] === 'final') {
    const sessionId = requireFlagValue(args, '--session')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'session.finalMessage', payload: { sessionId } },
      { pretty, timeoutMs },
    )

    return
  }

  if (command === 'session' && args[1] === 'kill') {
    const sessionId = requireFlagValue(args, '--session')
    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'session.kill', payload: { sessionId } },
      { pretty, timeoutMs },
    )

    return
  }

  process.stderr.write(`[opencove] unknown command: ${command}\n`)
  printUsage()
  process.exit(2)
}

main().catch(error => {
  process.stderr.write(`[opencove] failed: ${toErrorMessage(error)}\n`)
  process.exit(1)
})
