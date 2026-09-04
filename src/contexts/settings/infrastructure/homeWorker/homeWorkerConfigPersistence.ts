import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AtomicTextFileWriteDependencies {
  writeFile?: typeof writeFile
  rename?: typeof rename
  remove?: typeof rm
}

export async function writeTextFileAtomically(
  filePath: string,
  contents: string,
  dependencies: AtomicTextFileWriteDependencies = {},
): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const write = dependencies.writeFile ?? writeFile
  const move = dependencies.rename ?? rename
  const remove = dependencies.remove ?? rm
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await write(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
    await move(temporaryPath, filePath)
  } catch (error) {
    await remove(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}
