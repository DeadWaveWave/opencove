import type {
  FileSystemPort,
  CreateDirectoryInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
  FileSystemStat,
  WriteFileTextInput,
} from './ports'

export async function createDirectoryUseCase(
  port: FileSystemPort,
  input: CreateDirectoryInput,
): Promise<void> {
  await port.createDirectory(input)
}

export async function readFileBytesUseCase(
  port: FileSystemPort,
  input: ReadFileBytesInput,
): Promise<ReadFileBytesResult> {
  return await port.readFileBytes(input)
}

export async function readFileTextUseCase(
  port: FileSystemPort,
  input: ReadFileTextInput,
): Promise<ReadFileTextResult> {
  return await port.readFileText(input)
}

export async function writeFileTextUseCase(
  port: FileSystemPort,
  input: WriteFileTextInput,
): Promise<void> {
  await port.writeFileText(input)
}

export async function statUseCase(port: FileSystemPort, input: StatInput): Promise<FileSystemStat> {
  return await port.stat(input)
}

export async function readDirectoryUseCase(
  port: FileSystemPort,
  input: ReadDirectoryInput,
): Promise<ReadDirectoryResult> {
  return await port.readDirectory(input)
}
