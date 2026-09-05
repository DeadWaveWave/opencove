import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createNativeSshFixture } from './fixtures/create-native-ssh'

const FAKE_SSH_RUNTIME = String.raw`
import net from 'node:net'
import process from 'node:process'
import { access, appendFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'

const gateDir = process.env.OPENCOVE_FAKE_SSH_GATE_DIR
async function phaseGate(phase) {
  const line = '[opencove-bootstrap-progress:v1] ' + phase + '\n'
  process.stdout.write(line)
  await appendFile(path.join(gateDir, 'phases.log'), line)
  const release = path.join(gateDir, phase + '.release')
  const released = () => access(release).then(() => true, () => false)
  await new Promise((resolve, reject) => {
    const check = async () => { if (await released()) { watcher.close(); resolve() } }
    const watcher = watch(gateDir, () => { void check().catch(reject) })
    watcher.on('error', reject)
    void check().catch(reject)
  })
}

const args = process.argv.slice(2)
const portForwardIndex = args.indexOf('-L')
if (portForwardIndex >= 0) {
  if (gateDir) await appendFile(path.join(gateDir, 'tunnel-started'), 'started\n')
  const mapping = args[portForwardIndex + 1] ?? ''
  const [localPortRaw, targetHost, targetPortRaw] = mapping.split(':')
  const localPort = Number(localPortRaw)
  const targetPort = Number(targetPortRaw)

  if (!Number.isFinite(localPort) || !Number.isFinite(targetPort) || targetHost !== '127.0.0.1') {
    process.stderr.write('invalid port forwarding request\n')
    process.exit(1)
  }

  const sockets = new Set()
  const server = net.createServer(socket => {
    const upstream = net.createConnection({
      host: '127.0.0.1',
      port: targetPort,
    })

    sockets.add(socket)
    sockets.add(upstream)
    socket.pipe(upstream)
    upstream.pipe(socket)

    const closePair = () => {
      sockets.delete(socket)
      sockets.delete(upstream)
      socket.destroy()
      upstream.destroy()
    }

    socket.on('close', closePair)
    upstream.on('close', closePair)
    socket.on('error', closePair)
    upstream.on('error', closePair)
  })

  server.on('error', error => {
    process.stderr.write(String(error instanceof Error ? error.message : error) + '\n')
    process.exit(1)
  })

  const closeAndExit = () => {
    for (const socket of sockets) socket.destroy()
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

if (gateDir) {
  // Model observable bootstrap stages; actual scripts run in POSIX/Windows unit fixtures.
  for await (const chunk of process.stdin) { /* drain generated script */ }
  await phaseGate('checking_remote_runtime')
  await phaseGate('installing_runtime')
  await phaseGate('starting_runtime')
  if (process.env.OPENCOVE_FAKE_SSH_FAILURE) {
    process.stderr.write('[opencove-bootstrap:' + process.env.OPENCOVE_FAKE_SSH_FAILURE + '] Runtime activation deferred.\n')
    process.exit(1)
  }
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
    await createNativeSshFixture(installDir)
    return installDir
  }

  const wrapperPath = path.join(installDir, 'ssh')
  const wrapper = `#!/usr/bin/env node\n${FAKE_SSH_RUNTIME.trimStart()}\n`
  await writeFile(wrapperPath, wrapper, 'utf8')
  await chmod(wrapperPath, 0o755)
  return installDir
}
