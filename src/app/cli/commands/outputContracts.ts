import { lineageFields, lineageFieldDescriptions } from '../core/nodeLineage'
import { agentMetadataFields } from '../core/agentMetadata'
import { declaredOutput, noResultOutput } from './declaredOutput'
import type { RenderSpec } from '../core/command'
const nodeFields = [
  'id',
  'kind',
  'title',
  'projectId',
  'spaceId',
  'frame',
  'frame.x',
  'frame.y',
  'frame.width',
  'frame.height',
  'status',
  'sessionId',
]
const spaceFields = [
  'id',
  'name',
  'directoryPath',
  'targetMountId',
  'parentSpaceId',
  'boundary',
  'rect',
  'rect.x',
  'rect.y',
  'rect.width',
  'rect.height',
  'sortOrder',
  'nodeIds',
  'nodes',
]
const dataFields = [
  'kind',
  'content',
  'text',
  'requirement',
  'status',
  'priority',
  'tags',
  'linkedAgentNodeId',
  'url',
  'pinned',
  'sessionMode',
  'profileId',
  'provider',
  'prompt',
  'model',
  'effectiveModel',
  'executionDirectory',
  'expectedDirectory',
  'taskId',
  'runtimeKind',
]
const summaryDataFields = [
  'kind',
  'status',
  'priority',
  'requirement',
  'tags',
  'url',
  'linkedAgentNodeId',
]
const nodeSummaryMetadataFields = [
  ...agentMetadataFields,
  'taskNodeId',
  'data',
  ...summaryDataFields.map(field => `data.${field}`),
]
const spaceNodeFields = [...nodeFields, ...nodeSummaryMetadataFields].map(field => `nodes.${field}`)
export const nodeListOutput: RenderSpec = {
  defaultLimit: 50,
  listKey: 'nodes',
  fields: [...nodeFields, ...lineageFields, ...nodeSummaryMetadataFields],
  fieldDescriptions: lineageFieldDescriptions,
  fieldHints: Object.fromEntries(
    dataFields
      .filter(field => !summaryDataFields.includes(field))
      .map(field => [
        `data.${field}`,
        `Read full node content with "opencove node get --node <id> --fields data.${field}".`,
      ]),
  ),
  columns: ['id', 'kind', 'title', 'state'],
  tableFields: { state: ['data.status', 'status'] },
  examples: [
    'opencove node list --fields id,data.status',
    '{"projectId":"p","spaceId":null,"nodes":[{"id":"n","data":{"status":"doing"}}]}',
  ],
}
export const nodeGetOutput: RenderSpec = {
  itemKey: 'node',
  fields: [...nodeFields, ...lineageFields, 'data', ...dataFields.map(f => `data.${f}`)],
  fieldDescriptions: lineageFieldDescriptions,
  examples: ['--fields id,title', '{"node":{"id":"n","title":"Note"}}'],
}
const kindDataFields: Record<string, string[]> = {
  note: ['text'],
  task: ['requirement', 'status', 'priority', 'tags', 'linkedAgentNodeId'],
  website: ['url', 'pinned', 'sessionMode', 'profileId'],
  agent: [
    'provider',
    'prompt',
    'model',
    'effectiveModel',
    'executionDirectory',
    'expectedDirectory',
    'taskId',
  ],
  terminal: ['profileId', 'runtimeKind', 'executionDirectory', 'expectedDirectory'],
}
export function nodeKindOutput(kind: string, create: boolean): RenderSpec {
  return {
    itemKey: 'node',
    ...(create ? { fieldDescriptions: lineageFieldDescriptions } : {}),
    fields: [
      ...nodeFields,
      ...(create ? lineageFields : []),
      'data',
      'data.kind',
      ...kindDataFields[kind].map(field => `data.${field}`),
    ],
    examples: [
      '--fields id,title',
      JSON.stringify({
        revision: 1,
        ...(create ? { projectId: 'p', spaceId: 'space-123' } : {}),
        node: { id: 'n', title: kind[0].toUpperCase() + kind.slice(1) },
      }),
    ],
  }
}
export const projectListOutput: RenderSpec = {
  listKey: 'projects',
  examples: [
    'opencove project list --fields id,name',
    '{"activeProjectId":"p","projects":[{"id":"p","name":"Project"}]}',
  ],
  fields: ['id', 'name', 'path', 'worktreesRoot', 'activeSpaceId'],
  columns: ['id', 'name'],
}
export const spaceListOutput: RenderSpec = {
  listKey: 'spaces',
  examples: [
    'opencove space list --fields id,name',
    '{"projectId":"p","activeSpaceId":"s","spaces":[{"id":"s","name":"Main"}]}',
  ],
  fields: [...spaceFields, 'nodeCount', 'projectId', ...spaceNodeFields],
  columns: ['id', 'name', 'projectId'],
  envelopeFields: { projectId: 'projectId' },
}
export const spaceGetOutput: RenderSpec = {
  itemKey: 'space',
  fields: [...spaceFields, 'projectId', 'nodeCount', ...spaceNodeFields],
  examples: [
    'opencove space get --space s --fields id,nodes',
    '{"projectId":"p","activeSpaceId":"s","space":{"id":"s","nodes":[]}}',
  ],
}

const endpointFields = [
  'endpointId',
  'kind',
  'displayName',
  'createdAt',
  'updatedAt',
  'access',
  'remote',
  'remote.hostname',
  'remote.port',
]
const mountFields = [
  'mountId',
  'projectId',
  'name',
  'sortOrder',
  'endpointId',
  'targetId',
  'rootPath',
  'rootUri',
  'createdAt',
  'updatedAt',
]

export const remoteOutputs: Record<string, RenderSpec> = {
  'endpoint.register': declaredOutput(
    endpointFields,
    { endpoint: { endpointId: 'remote' } },
    { itemKey: 'endpoint' },
  ),
  'endpoint.ping': declaredOutput(['ok', 'endpointId', 'now', 'pid'], { ok: true }),
  'endpoint.remove': declaredOutput(['removedMountCount'], { removedMountCount: 0 }),
  'mount.create': declaredOutput(mountFields, { mount: { mountId: 'm' } }, { itemKey: 'mount' }),
  'mount.remove': noResultOutput,
  'mountTarget.resolve': declaredOutput(
    ['mountId', 'projectId', 'endpointId', 'targetId', 'rootPath', 'rootUri'],
    { mountId: 'm' },
  ),
  'worktree.create': declaredOutput(
    ['path', 'head', 'branch'],
    {
      projectId: 'p',
      activeSpaceId: 's',
      spaceId: 's',
      spaceDirectoryPath: '/repo',
      spaceName: 'Main',
      worktree: { path: '/repo' },
    },
    { itemKey: 'worktree' },
  ),
  'worktree.archive': declaredOutput(
    ['deletedBranchName', 'branchDeleteError', 'directoryCleanupError'],
    {
      projectId: 'p',
      activeSpaceId: 's',
      spaceId: 's',
      spaceDirectoryPath: '/repo',
      removed: { deletedBranchName: 'branch' },
    },
    { itemKey: 'removed' },
  ),
  'session.launchAgent': declaredOutput(
    [
      'sessionId',
      'provider',
      'startedAt',
      'executionContext',
      'profileId',
      'runtimeKind',
      'resumeSessionId',
      'effectiveModel',
      'command',
      'args',
    ],
    { sessionId: 's' },
  ),
  'session.kill': noResultOutput,
  'pty.spawnInMount': declaredOutput(['sessionId', 'profileId', 'runtimeKind'], { sessionId: 's' }),
  'endpoint.list': {
    listKey: 'endpoints',
    fields: endpointFields,
    examples: [
      'opencove endpoint list --fields endpointId',
      '{"endpoints":[{"endpointId":"local"}]}',
    ],
  },
  'mount.list': {
    listKey: 'mounts',
    fields: mountFields,
    examples: [
      'opencove mount list --project p --fields mountId,rootUri',
      '{"projectId":"p","mounts":[{"mountId":"m","rootUri":"file:///repo"}]}',
    ],
  },
  'worktree.list': {
    listKey: 'worktrees',
    fields: ['path', 'head', 'branch'],
    examples: [
      'opencove worktree list --fields path',
      '{"projectId":"p","repoPath":"/repo","worktreesRoot":"/trees","worktrees":[{"path":"/repo"}]}',
    ],
  },
  'session.get': {
    fields: [
      'sessionId',
      'provider',
      'startedAt',
      'cwd',
      'prompt',
      'model',
      'effectiveModel',
      'executionContext',
      'resumeSessionId',
      'command',
      'args',
    ],
    examples: ['opencove session get --session s --fields sessionId', '{"sessionId":"s"}'],
  },
  'session.finalMessage': {
    fields: ['sessionId', 'provider', 'startedAt', 'cwd', 'resumeSessionId', 'message'],
    examples: ['opencove session final --session s --fields message', '{"message":"Done"}'],
  },
}

export const nodeDeleteOutput = declaredOutput(
  [
    'nodeId',
    'revision',
    'projectId',
    'spaceId',
    'runtimeCleanup',
    'runtimeCleanup.attempted',
    'runtimeCleanup.ok',
  ],
  { nodeId: 'n' },
)
export const canvasFocusOutput = (kind: 'node' | 'space') =>
  declaredOutput(
    ['kind', 'nodeId', 'spaceId'],
    { projectId: 'p', target: { kind }, delivered: true, deliveredClientCount: 1 },
    { itemKey: 'target' },
  )
