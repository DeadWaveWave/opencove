import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readJsonFile } from './topologyEndpointAccess'
import {
  normalizeSecretsFile,
  normalizeTopologyFile,
  type SecretsFileV1,
  type TopologyFileV1,
} from './topologyFileV1'

export type TopologyState = {
  topology: TopologyFileV1
  secrets: SecretsFileV1
}

async function writeJsonAtomically(
  path: string,
  payload: string,
  write: typeof writeFile,
): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await write(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readTopologyState(input: {
  topologyPath: string
  secretsPath: string
}): Promise<TopologyState> {
  const [rawTopology, rawSecrets] = await Promise.all([
    readJsonFile(input.topologyPath),
    readJsonFile(input.secretsPath),
  ])

  return {
    topology: normalizeTopologyFile(rawTopology),
    secrets: normalizeSecretsFile(rawSecrets),
  }
}

export async function persistTopologyState(input: {
  topologyPath: string
  secretsPath: string
  state: TopologyState
  writeFileImpl?: typeof writeFile
}): Promise<void> {
  await mkdir(dirname(input.topologyPath), { recursive: true })
  const write = input.writeFileImpl ?? writeFile

  const writes = await Promise.allSettled([
    writeJsonAtomically(input.topologyPath, `${JSON.stringify(input.state.topology)}\n`, write),
    writeJsonAtomically(input.secretsPath, `${JSON.stringify(input.state.secrets)}\n`, write),
  ])
  const failure = writes.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}
