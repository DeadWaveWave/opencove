import { lineageFields, lineageFieldDescriptions } from '../core/nodeLineage'
import { contextNodeSummary, contextSelf } from './contextNodes'
import { agentMetadataFields, nodeAgentMetadata } from '../core/agentMetadata'
import { defineCommand } from '../core/command'
import { identityFields } from '../core/identity'
import { usage } from '../core/errors'
import type { ListProjectsResult, GetSpaceResult } from '../../../shared/contracts/dto'
import type { ListNodesResult } from '../../../shared/contracts/dto/nodeControl'
import { shellWord } from '../core/shellWord'
const selfSelector = shellWord('@self')

export const identityCommands = [
  defineCommand({
    path: ['whoami'],
    summary: 'Show your caller identity and permission scope',
    description:
      'Inside an OpenCove terminal, caller is session-grant and scope is interact. With a desktop token, caller is bearer and scope is admin. projectId, spaceId, nodeId and sessionId are null when the caller has no session identity; spaceId is also null outside any Space. Standalone sessions keep their interact grant and project/Space identity, with nodeId: null. Credentials are never printed.',
    connect: true,
    operation: 'system.whoami',
    buildInput: () => ({}),
    execute: async ({ whoami }) => whoami(),
    render: {
      fields: identityFields,
      examples: [
        'opencove whoami --fields caller,scope',
        '{"caller":"session-grant","scope":"interact"}',
      ],
    },
    examples: ['opencove whoami', 'opencove whoami --fields caller,scope,nodeId'],
  }),
  defineCommand({
    path: ['context'],
    summary: 'Show your project, space and neighboring nodes',
    description:
      'With no explicit target, inside OpenCove defaults to your own space. Terminals outside any space show their project with space: null and no neighbors. Outside OpenCove, provide --space or --project. An explicit project selects its active space. self contains your caller identity and node summary in self.node (null without a canvas node); project and space describe the target you asked about, which may differ from self. For agent nodes, state is the Worker run state (idle, working, waiting, exited or unknown) from agent.list; missing observations are unknown, never inferred from lifecycle. sessionStatus preserves the agent session lifecycle (for example running). For tasks, state is task status; for terminals, state remains session lifecycle; for other nodes it is null. agentState {state, quality, turnId} exposes work state for agent nodes and observed agents in terminals: working means the agent is working. taskNodeId is the reverse task link, or null when absent or ambiguous.',
    connect: true,
    options: {
      space: {
        type: 'string',
        valueName: 'id',
        description: 'Orient yourself in this space',
        defaultSelf: false,
      },
      project: { type: 'string', valueName: 'id', description: 'Orient yourself in this project' },
    },
    buildInput: ({ options }) => {
      if (options.space === undefined && options.project === undefined) {
        usage('context requires --space or --project outside OpenCove.')
      }
      return null
    },
    render: {
      examples: [
        `opencove context --space ${selfSelector} --fields space.name`,
        '{"space":{"name":"Main"}}',
      ],
      fields: [
        'self',
        ...identityFields.map(field => `self.${field}`),
        'self.node',
        ...[
          'id',
          'kind',
          'title',
          'state',
          ...lineageFields,
          ...agentMetadataFields,
          'taskNodeId',
        ].map(field => `self.node.${field}`),
        'project',
        'project.id',
        'project.name',
        'project.path',
        'space',
        'space.id',
        'space.name',
        'space.directoryPath',
        'nodes',
        'nodes.id',
        'nodes.kind',
        'nodes.title',
        'nodes.state',
        ...lineageFields.map(field => `nodes.${field}`),
        ...agentMetadataFields.map(field => `nodes.${field}`),
        'nodes.taskNodeId',
        'next',
      ],
      fieldDescriptions: Object.fromEntries(
        ['self.node', 'nodes'].flatMap(prefix =>
          Object.entries(lineageFieldDescriptions).map(([field, description]) => [
            `${prefix}.${field}`,
            description,
          ]),
        ),
      ),
    },
    examples: [
      `opencove context --space ${selfSelector}`,
      'opencove context --project project-123 --fields project,space,next',
    ],
    async execute({ options, explicitOptions, io, invoke, selfSelected, whoami }) {
      const inside = io.env.OPENCOVE_ENV === '1' || selfSelected
      const identity = inside ? await whoami() : undefined
      const projects = ((await invoke('project.list', null)) as ListProjectsResult).projects
      let projectId = options.project as string | undefined
      let spaceId = options.space as string | undefined
      let space: GetSpaceResult['space'] | undefined
      if (!spaceId) {
        spaceId =
          inside && !explicitOptions?.has('project')
            ? (identity?.spaceId ?? undefined)
            : (projects.find(project => project.id === projectId)?.activeSpaceId ?? undefined)
      }
      if (spaceId) {
        const result = (await invoke('space.get', { spaceId })) as GetSpaceResult
        projectId = result.projectId
        space = result.space
      }
      const project = projects.find(candidate => candidate.id === projectId)
      const nodes = spaceId
        ? ((await invoke('node.list', { space: { kind: 'spaceId', spaceId } })) as ListNodesResult)
            .nodes
        : []
      const enrichedNodes = await nodeAgentMetadata(
        nodes,
        { invoke, io, options },
        { spaceId, projectId },
        true,
      )
      const target =
        spaceId && spaceId === identity?.spaceId
          ? selfSelector
          : spaceId
            ? shellWord(spaceId)
            : undefined
      const projectTarget = projectId === identity?.projectId ? selfSelector : shellWord(projectId!)
      const next = target
        ? [
            `opencove node list --space ${target}`,
            `opencove space get --space ${target}`,
            `opencove node create note --space ${target} --text 'Progress update'`,
          ]
        : [
            `opencove space list --project ${projectTarget}`,
            `opencove mount list --project ${projectTarget}`,
            'opencove project list',
          ]
      if (inside && identity?.nodeId) {
        next.unshift(`opencove node get --node ${selfSelector}`)
      }
      if (nodes.some(node => node.kind === 'task')) {
        next.push(`opencove node list --space ${target} --kind task --fields id,title,data.status`)
      }
      return {
        self: await contextSelf(identity, nodes, { invoke, io, options }),
        project: project ? { id: project.id, name: project.name, path: project.path } : null,
        space: space
          ? { id: space.id, name: space.name, directoryPath: space.directoryPath }
          : null,
        nodes: enrichedNodes.filter(node => node.id !== identity?.nodeId).map(contextNodeSummary),
        next,
      }
    },
  }),
]
