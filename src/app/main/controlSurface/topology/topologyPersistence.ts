import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SecretsFileV1, TopologyFileV1 } from './topologyFileV1'

async function writeJsonAtomically(path: string, payload: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function persistTopologyFiles(input: {
  topologyPath: string
  secretsPath: string
  topology: TopologyFileV1
  secrets: SecretsFileV1
}): Promise<void> {
  await mkdir(dirname(input.topologyPath), { recursive: true })
  await Promise.all([
    writeJsonAtomically(input.topologyPath, `${JSON.stringify(input.topology)}\n`),
    writeJsonAtomically(input.secretsPath, `${JSON.stringify(input.secrets)}\n`),
  ])
}
