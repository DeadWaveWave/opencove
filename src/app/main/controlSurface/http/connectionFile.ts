import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export async function writeConnectionFile(
  userDataPath: string,
  info: unknown,
  fileName: string,
): Promise<void> {
  const filePath = resolve(userDataPath, fileName)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(info)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function removeConnectionFile(userDataPath: string, fileName: string): Promise<void> {
  const filePath = resolve(userDataPath, fileName)
  await rm(filePath, { force: true })
}
