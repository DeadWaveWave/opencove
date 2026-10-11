// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createLocalFileSystemPort } from '../../../src/contexts/filesystem/infrastructure/localFileSystemPort'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'
import {
  readFileTextUseCase,
  writeFileTextUseCase,
  createDirectoryUseCase,
  deleteEntryUseCase,
  renameEntryUseCase,
} from '../../../src/contexts/filesystem/application/usecases'
import { createAppError } from '../../../src/shared/errors/appError'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('classifies actual filesystem failures without changing disk contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cove-file-errors-'))
  roots.push(root)
  const port = createLocalFileSystemPort()
  const uri = toFileUri(join(root, 'existing.txt'))
  await writeFile(join(root, 'existing.txt'), 'keep')
  await expect(
    readFileTextUseCase(port, { uri: toFileUri(join(root, 'missing.txt')) }),
  ).rejects.toMatchObject({
    code: 'filesystem.read_file_text_failed',
    params: { reason: 'not_found' },
    message: expect.stringContaining('does not exist'),
  })
  await expect(
    writeFileTextUseCase(port, { uri, content: 'destroy', overwrite: false }),
  ).rejects.toMatchObject({
    code: 'filesystem.write_file_text_failed',
    params: { reason: 'already_exists' },
    message: expect.stringContaining('already exists'),
  })
  await expect(createDirectoryUseCase(port, { uri: toFileUri(root) })).rejects.toMatchObject({
    code: 'filesystem.create_directory_failed',
    params: { reason: 'already_exists' },
  })
  await mkdir(join(root, 'folder'))
  await writeFile(join(root, 'folder', 'keep'), 'keep')
  await expect(
    deleteEntryUseCase(port, { uri: toFileUri(join(root, 'folder')), recursive: false }),
  ).rejects.toMatchObject({
    code: 'filesystem.delete_entry_failed',
    params: { reason: 'not_empty' },
  })
  await expect(
    renameEntryUseCase(port, {
      sourceUri: uri,
      targetUri: toFileUri(join(root, 'folder', 'keep')),
    }),
  ).rejects.toMatchObject({
    code: 'filesystem.rename_entry_failed',
    params: { reason: 'already_exists' },
  })
  expect(await readFile(join(root, 'existing.txt'), 'utf8')).toBe('keep')
})

it('keeps existing AppError authority failures and hides arbitrary provider messages', async () => {
  const port = createLocalFileSystemPort()
  const error = createAppError('common.approved_path_required')
  vi.spyOn(port, 'readFileText')
    .mockRejectedValueOnce(error)
    .mockRejectedValueOnce(
      Object.assign(new Error('token=secret; private path'), { code: 'EWHATEVER' }),
    )
    .mockRejectedValueOnce(Object.assign(new Error('token=secret'), { code: 'EACCES' }))
  await expect(readFileTextUseCase(port, { uri: 'file:///missing' })).rejects.toBe(error)
  await expect(readFileTextUseCase(port, { uri: 'file:///missing' })).rejects.toMatchObject({
    code: 'filesystem.read_file_text_failed',
    message: 'Unable to read the file.',
  })
  await expect(readFileTextUseCase(port, { uri: 'file:///missing' })).rejects.toMatchObject({
    code: 'filesystem.read_file_text_failed',
    params: { reason: 'permission_denied' },
    message: 'Unable to read the file. Permission denied.',
  })
})
