import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const FAKE_SSH_RUNTIME = String.raw`
import net from 'node:net'
import process from 'node:process'

const args = process.argv.slice(2)
const portForwardIndex = args.indexOf('-L')
if (portForwardIndex >= 0) {
  const mapping = args[portForwardIndex + 1] ?? ''
  const [localPortRaw, targetHost, targetPortRaw] = mapping.split(':')
  const localPort = Number(localPortRaw)
  const targetPort = Number(targetPortRaw)

  if (!Number.isFinite(localPort) || !Number.isFinite(targetPort) || targetHost !== '127.0.0.1') {
    process.stderr.write('invalid port forwarding request\n')
    process.exit(1)
  }

  const server = net.createServer(socket => {
    const upstream = net.createConnection({
      host: '127.0.0.1',
      port: targetPort,
    })

    socket.pipe(upstream)
    upstream.pipe(socket)

    const closePair = () => {
      socket.destroy()
      upstream.destroy()
    }

    socket.on('error', closePair)
    upstream.on('error', closePair)
  })

  server.on('error', error => {
    process.stderr.write(String(error instanceof Error ? error.message : error) + '\n')
    process.exit(1)
  })

  const closeAndExit = () => {
    server.close(() => {
      process.exit(0)
    })
  }

  process.on('SIGINT', closeAndExit)
  process.on('SIGTERM', closeAndExit)

  server.listen(localPort, '127.0.0.1')
  await new Promise(() => undefined)
}

const posixProbe = args.find(argument => argument.includes('printf posix'))
if (posixProbe) {
  process.stdout.write('posix')
  process.exit(0)
}

const windowsProbe = args.find(argument => argument.includes('$PSVersionTable.PSVersion.ToString()'))
if (windowsProbe) {
  process.stdout.write('7.4.0')
  process.exit(0)
}

process.stdin.resume()
process.stdin.on('data', () => {})
process.exit(0)
`

export async function createFakeManagedSshInstallDir(): Promise<string> {
  const installDir = await mkdtemp(path.join(tmpdir(), 'opencove-fake-ssh-'))
  const runtimePath = path.join(installDir, 'ssh.mjs')
  await writeFile(runtimePath, FAKE_SSH_RUNTIME.trimStart(), 'utf8')

  if (process.platform === 'win32') {
    const wrapperPath = path.join(installDir, 'ssh.cmd')
    const wrapper = `@echo off\r\n"${process.execPath}" "${runtimePath}" %*\r\n`
    await writeFile(wrapperPath, wrapper, 'utf8')
    return installDir
  }

  const wrapperPath = path.join(installDir, 'ssh')
  const wrapper = `#!/usr/bin/env node\n${FAKE_SSH_RUNTIME.trimStart()}\n`
  await writeFile(wrapperPath, wrapper, 'utf8')
  await chmod(wrapperPath, 0o755)
  return installDir
}
