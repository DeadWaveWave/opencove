import { noResultOutput } from './declaredOutput'
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
    description:
      'File access is limited to approved roots. Run "opencove mount list --project <id>" to see approved root URIs; select a mount with --mount when needed.',
    connect: true,
    render:
      name === 'ls'
        ? {
            listKey: 'entries',
            fields: ['name', 'uri', 'kind'],
            examples: [
              'opencove fs ls --uri file:///repo --fields name',
              '{"entries":[{"name":"README.md"}]}',
            ],
          }
        : name === 'read'
          ? {
              fields: ['content'],
              examples: [
                'opencove fs read --uri file:///repo/README.md --fields content',
                '{"content":"Hello"}',
              ],
            }
          : name === 'stat'
            ? {
                fields: ['uri', 'kind', 'sizeBytes', 'mtimeMs'],
                examples: [
                  'opencove fs stat --uri file:///repo --fields kind',
                  '{"kind":"directory"}',
                ],
              }
            : noResultOutput,
    operation,
    operationAliases: [mountedOperation],
    selectOperation: ({ options }) => (options.mount === undefined ? operation : mountedOperation),
    options: {
      uri: option('Select the absolute file:// URI of the file or directory', 'uri', true),
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
