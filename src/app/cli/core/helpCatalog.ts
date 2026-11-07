export const sections: [string, [string, string][]][] = [
  [
    'Workspace',
    [
      ['project', 'List projects and find their IDs'],
      ['space', 'List and inspect project spaces'],
      ['node', 'Create, read, update and delete canvas nodes'],
      ['canvas', 'Focus nodes and spaces on the canvas'],
      ['agent', 'List, inspect, prompt, wait for and read agents'],
    ],
  ],
  [
    'Introspection',
    [
      ['skill', 'Print the bundled agent usage guide'],
      ['whoami', 'Show your caller identity and permission scope'],
      ['context', 'Orient yourself in a project and space'],
      ['api', 'Discover operations, inspect input schemas and invoke the Control Surface'],
    ],
  ],
  [
    'Runtime',
    [
      ['ping', 'Check whether the Control Surface responds'],
      ['status', 'Show protocol, app version and instance identity'],
      ['worker', 'Start, inspect and stop local workers'],
      ['runtime', 'Inspect, verify and prepare managed runtimes'],
      ['endpoint', 'Register and manage remote worker connections'],
      ['mount', 'Connect project folders to worker endpoints'],
      ['fs', 'Read, write and inspect files through the Control Surface'],
      ['worktree', 'List, create and archive Git worktrees'],
      ['session', 'Run agents and inspect or stop their sessions'],
      ['pty', 'Start and attach to terminal sessions'],
    ],
  ],
  ['Plugins', [['plugin', 'Discover, install and manage plugins']]],
]
export const commandExamples: Record<string, string[]> = {
  ping: ['opencove ping', 'opencove --user-data ./profile ping'],
  status: ['opencove status', 'opencove status --pretty'],
  'project list': ['opencove project list', 'opencove project list --fields id,name'],
  'space list': ['opencove space list', 'opencove space list --project project-123'],
  'space get': [
    'opencove space get --space space-123',
    'opencove space get --space space-123 --pretty',
  ],
  'node list': [
    'opencove node list --space space-123',
    'opencove node list --space space-123 --fields nodes.id,nodes.title',
  ],
  'node get': [
    'opencove node get --node node-123',
    'opencove node get --node node-123 --fields node.id,node.title',
  ],
  'node delete': [
    'opencove node delete --node node-123',
    'opencove --user-data ./profile node delete --node node-123',
  ],
  'canvas focus node': [
    'opencove canvas focus node --node node-123',
    'opencove --user-data ./profile canvas focus node --node node-123',
  ],
  'canvas focus space': [
    'opencove canvas focus space --space space-123',
    'opencove canvas focus space --space-name "Sprint planning" --project project-123',
  ],
  'api ops': [
    'opencove api ops --domains',
    'opencove api ops --search create',
    'opencove api ops --prefix node --fields id,cliCommand',
    'opencove api ops --kind query --contract schema',
  ],
  'api schema': [
    'opencove api schema node.create',
    'opencove api schema node.create --variant note',
    'opencove api schema system.operation.describe --pretty',
  ],
  'api call': [
    'opencove api call project.list',
    'opencove api call node.create --input-file ./new-note.json',
  ],
}
