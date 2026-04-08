import WebSocket from 'ws'

import { readFlagValue, requireFlagValue } from '../args.mjs'
import { invokeAndPrint } from '../invoke.mjs'

function toWsUrl(connection, path, query) {
  const url = new URL(`http://${connection.hostname}:${connection.port}`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = path
  url.search = ''
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function tryHandleMultiEndpointCommands({
  command,
  args,
  connection,
  pretty,
  timeoutMs,
}) {
  if (command === 'endpoint' && args[1] === 'list') {
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'endpoint.list', payload: null },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'endpoint' && args[1] === 'register') {
    const hostname = requireFlagValue(args, '--hostname')
    const portRaw = requireFlagValue(args, '--port')
    const remoteToken = requireFlagValue(args, '--remote-token')
    const displayName = readFlagValue(args, '--display-name')

    const port = Number(portRaw)
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      process.stderr.write(`[opencove] invalid --port: ${portRaw}\n`)
      process.exit(2)
    }

    await invokeAndPrint(
      connection,
      {
        kind: 'command',
        id: 'endpoint.register',
        payload: {
          hostname,
          port,
          token: remoteToken,
          ...(displayName ? { displayName } : {}),
        },
      },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'endpoint' && args[1] === 'ping') {
    const endpointId = requireFlagValue(args, '--endpoint-id')
    const pingTimeoutRaw = readFlagValue(args, '--ping-timeout')
    const pingTimeoutMs = pingTimeoutRaw ? Number(pingTimeoutRaw) : null

    const payload = {
      endpointId,
      ...(Number.isFinite(pingTimeoutMs) && pingTimeoutMs > 0
        ? { timeoutMs: Math.floor(pingTimeoutMs) }
        : {}),
    }

    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'endpoint.ping', payload },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'endpoint' && args[1] === 'remove') {
    const endpointId = requireFlagValue(args, '--endpoint-id')
    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'endpoint.remove', payload: { endpointId } },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'mount' && args[1] === 'list') {
    const projectId =
      readFlagValue(args, '--project') ??
      readFlagValue(args, '--project-id') ??
      readFlagValue(args, '--space') ??
      requireFlagValue(args, '--project')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'mount.list', payload: { projectId } },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'mount' && args[1] === 'create') {
    const projectId =
      readFlagValue(args, '--project') ??
      readFlagValue(args, '--project-id') ??
      readFlagValue(args, '--space') ??
      requireFlagValue(args, '--project')
    const endpointId = requireFlagValue(args, '--endpoint-id')
    const rootPath = requireFlagValue(args, '--root-path')
    const name = readFlagValue(args, '--name')

    await invokeAndPrint(
      connection,
      {
        kind: 'command',
        id: 'mount.create',
        payload: {
          projectId,
          endpointId,
          rootPath,
          ...(name ? { name } : {}),
        },
      },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'mount' && args[1] === 'remove') {
    const mountId = requireFlagValue(args, '--mount')
    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'mount.remove', payload: { mountId } },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'mount' && args[1] === 'resolve') {
    const mountId = requireFlagValue(args, '--mount')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'mountTarget.resolve', payload: { mountId } },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'fs' && args[1] === 'read-in-mount') {
    const mountId = requireFlagValue(args, '--mount')
    const uri = requireFlagValue(args, '--uri')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'filesystem.readFileTextInMount', payload: { mountId, uri } },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'fs' && args[1] === 'write-in-mount') {
    const mountId = requireFlagValue(args, '--mount')
    const uri = requireFlagValue(args, '--uri')
    const content = requireFlagValue(args, '--content')
    await invokeAndPrint(
      connection,
      {
        kind: 'command',
        id: 'filesystem.writeFileTextInMount',
        payload: { mountId, uri, content },
      },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'fs' && args[1] === 'stat-in-mount') {
    const mountId = requireFlagValue(args, '--mount')
    const uri = requireFlagValue(args, '--uri')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'filesystem.statInMount', payload: { mountId, uri } },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'fs' && args[1] === 'ls-in-mount') {
    const mountId = requireFlagValue(args, '--mount')
    const uri = requireFlagValue(args, '--uri')
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'filesystem.readDirectoryInMount', payload: { mountId, uri } },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'pty' && args[1] === 'spawn-in-mount') {
    const mountId = requireFlagValue(args, '--mount')
    const cwdUri = readFlagValue(args, '--cwd-uri')
    const shell = readFlagValue(args, '--shell')
    const profileId = readFlagValue(args, '--profile-id')
    const colsRaw = readFlagValue(args, '--cols')
    const rowsRaw = readFlagValue(args, '--rows')

    const cols = colsRaw ? Number(colsRaw) : null
    const rows = rowsRaw ? Number(rowsRaw) : null

    const payload = {
      mountId,
      ...(cwdUri ? { cwdUri } : {}),
      ...(shell ? { shell } : {}),
      ...(profileId ? { profileId } : {}),
      ...(Number.isFinite(cols) && cols > 0 ? { cols: Math.floor(cols) } : {}),
      ...(Number.isFinite(rows) && rows > 0 ? { rows: Math.floor(rows) } : {}),
    }

    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'pty.spawnInMount', payload },
      { pretty, timeoutMs },
    )

    return true
  }

  if (command === 'pty' && args[1] === 'attach') {
    const sessionId = requireFlagValue(args, '--session')
    const wsUrl = toWsUrl(connection, '/pty', { token: connection.token })

    const ws = new WebSocket(wsUrl, 'opencove-pty.v1')
    await new Promise((resolvePromise, rejectPromise) => {
      ws.once('open', resolvePromise)
      ws.once('error', rejectPromise)
    })

    const sendJson = payload => {
      ws.send(JSON.stringify(payload))
    }

    const waitForHelloAck = () =>
      new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          ws.terminate()
          rejectPromise(new Error('Timed out waiting for hello_ack'))
        }, 2000)

        const cleanup = () => {
          clearTimeout(timer)
          ws.off('message', onMessage)
          ws.off('error', onError)
          ws.off('close', onClose)
        }

        const onError = error => {
          cleanup()
          rejectPromise(error)
        }

        const onClose = () => {
          cleanup()
          rejectPromise(new Error('Socket closed before hello_ack'))
        }

        const onMessage = raw => {
          const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
          let parsed
          try {
            parsed = JSON.parse(text)
          } catch {
            return
          }

          if (!isRecord(parsed)) {
            return
          }

          if (parsed.type === 'error') {
            cleanup()
            rejectPromise(new Error(String(parsed.message || parsed.code || 'PTY error')))
            return
          }

          if (parsed.type !== 'hello_ack') {
            return
          }

          cleanup()
          resolvePromise()
        }

        ws.on('message', onMessage)
        ws.once('error', onError)
        ws.once('close', onClose)
      })

    sendJson({ type: 'hello', protocolVersion: 1, client: { kind: 'cli', version: null } })
    await waitForHelloAck()

    sendJson({ type: 'attach', sessionId, role: 'controller' })

    await new Promise((resolvePromise, rejectPromise) => {
      ws.on('message', raw => {
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          return
        }

        if (!isRecord(parsed) || typeof parsed.type !== 'string') {
          return
        }

        if (parsed.type === 'data' && typeof parsed.data === 'string') {
          process.stdout.write(parsed.data)
        }

        if (parsed.type === 'exit') {
          const exitCode = Number.isFinite(parsed.exitCode) ? Math.floor(parsed.exitCode) : 0
          ws.close()
          process.exit(exitCode === 0 ? 0 : 1)
        }

        if (parsed.type === 'error') {
          process.stderr.write(
            `[opencove] pty error: ${String(parsed.code || 'unknown')}: ${String(parsed.message || '')}\n`,
          )
          ws.close()
          process.exit(1)
        }
      })

      ws.once('error', rejectPromise)
      ws.once('close', resolvePromise)
    })

    return true
  }

  return false
}
