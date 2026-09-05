import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { getRuntimeBuildIdentity } from '../../shared/runtime/runtimeBuildIdentity'
import { parseRuntimeBuildIdentity } from '../../shared/contracts/runtimeBuild'
import { createManagedDeploymentPort } from '../../contexts/topology/infrastructure/managedRuntime/createManagedDeploymentPort'
import { prepareManagedDeployment } from '../../contexts/topology/application/prepareManagedDeployment'
import { verifyNativeRuntime } from './verifyNativeRuntime'

async function main(): Promise<void> {
  const build = getRuntimeBuildIdentity()
  if (!build) {
    throw new Error('[opencove-bootstrap:runtime_corrupt] Missing embedded build identity.')
  }
  if (process.argv[2] === 'verify') {
    await verifyNativeRuntime()
    process.stdout.write(
      `${JSON.stringify({
        build,
        platform: process.platform,
        arch: process.arch,
        nodeAbi: process.versions.modules,
        engine: process.versions.electron ? 'electron' : 'node',
      })}\n`,
    )
    return
  }
  if (process.argv[2] !== 'prepare') {
    throw new Error('Expected verify or prepare.')
  }
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += String(chunk)
    if (raw.length > 16_384) {
      throw new Error('Runtime request is too large.')
    }
  }
  const input = JSON.parse(raw.replace(/^\uFEFF/, '')) as Record<string, unknown>
  const desired = parseRuntimeBuildIdentity(input.runtimeBuild)
  if (!desired || JSON.stringify(desired) !== JSON.stringify(build)) {
    throw new Error(
      '[opencove-bootstrap:build_mismatch] Installed runtime does not match the requesting Desktop build.',
    )
  }
  if (
    typeof input.endpointId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(input.endpointId) ||
    typeof input.operationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId) ||
    typeof input.token !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(input.token) ||
    typeof input.port !== 'number' ||
    !Number.isSafeInteger(input.port) ||
    input.port < 1 ||
    input.port > 65_535
  ) {
    throw new Error('Invalid managed runtime request.')
  }
  const windows = process.platform === 'win32'
  const config = windows
    ? (process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'))
    : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))
  const state = windows
    ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'))
    : (process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'))
  const suffix = join(windows ? 'OpenCove' : 'opencove', 'managed-ssh', input.endpointId)
  const port = await createManagedDeploymentPort({
    connection: { deploymentId: input.endpointId, port: input.port, token: input.token },
    profile: join(config, suffix),
    state: join(state, suffix),
  })
  try {
    await prepareManagedDeployment(
      port,
      { root: resolve(__dirname, '../..'), build },
      input.operationId,
    )
    process.stdout.write('[opencove-bootstrap-progress:v1] waiting_for_runtime\n')
  } finally {
    port.dispose()
  }
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
