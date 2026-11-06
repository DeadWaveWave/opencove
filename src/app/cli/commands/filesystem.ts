import { defineCommand } from '../core/command'
import { option } from './remote'
export const filesystemCommands = (
  [
    ['read', 'filesystem.readFileText', 'filesystem.readFileTextInMount', 'Read a text file'],
    ['write', 'filesystem.writeFileText', 'filesystem.writeFileTextInMount', 'Write a text file'],
    ['stat', 'filesystem.stat', 'filesystem.statInMount', 'Inspect file metadata'],
    ['ls', 'filesystem.readDirectory', 'filesystem.readDirectoryInMount', 'List a directory'],
  ] as const
).map(([name, operation, mountedOperation, summary]) =>
  defineCommand({
    path: ['fs', name],
    summary,
    connect: true,
    operation,
    selectOperation: ({ options }) => (options.mount === undefined ? operation : mountedOperation),
    options: {
      uri: option('Select the file or directory URI', 'uri', true),
      mount: option('Resolve the URI within this mount', 'id'),
      ...(name === 'write'
        ? {
            content: {
              ...option('Write these exact UTF-8 contents', 'text', true),
              fileVariant: true as const,
            },
          }
        : {}),
    },
    buildInput: ({ options: o }) => ({
      uri: o.uri,
      ...(o.mount !== undefined ? { mountId: o.mount } : {}),
      ...(name === 'write' ? { content: o.content } : {}),
    }),
    examples: [
      `opencove fs ${name} --uri file:///workspace/${name === 'ls' ? '' : 'notes.txt'}${name === 'write' ? ' --content-file ./notes.txt' : ''}`,
    ],
  }),
)
