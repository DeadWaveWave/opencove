// Public help for commands still executed by the compatibility dispatcher.
// Keep entries aligned with run.mjs, commands/*.mjs and runtimeCommand.mjs.
export const sections: [string, [string, string][]][] = [
  [
    'Workspace',
    [
      ['project', 'List projects and find their IDs'],
      ['space', 'List and inspect project spaces'],
      ['node', 'Create, read, update and delete canvas nodes'],
      ['canvas', 'Focus nodes and spaces on the canvas'],
    ],
  ],
  [
    'Introspection',
    [['api', 'Discover operations, inspect input schemas and invoke the Control Surface']],
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
export const legacyHelp: Record<string, [string, string][]> = {
  worker: [
    ['start [--user-data <dir>] [--hostname <host>] [--port <port>]', 'Start a local worker'],
    ['status [--all] [--user-data <dir>]', 'Inspect local worker status'],
    ['stop [--user-data <dir>] [--pid <pid>] [--force]', 'Stop a local worker'],
  ],
  runtime: [
    ['inspect', 'Inspect the runtime build'],
    ['verify', 'Verify the runtime environment'],
    ['prepare', 'Prepare a managed runtime deployment'],
  ],
  endpoint: [
    ['list', 'List registered endpoints'],
    ['register --hostname <host> --port <port> --remote-token <token>', 'Register a remote worker'],
    ['ping --endpoint-id <id>', 'Check a remote worker connection'],
    ['remove --endpoint-id <id>', 'Remove a registered endpoint'],
  ],
  mount: [
    ['list --project <id>', 'List project mounts'],
    [
      'create --project <id> --endpoint-id <id> --root-path <path>',
      'Mount a worker folder in a project',
    ],
    ['resolve --mount <id>', 'Resolve a mount location'],
    ['remove --mount <id>', 'Remove a project mount'],
  ],
  fs: [
    ['read --uri <uri>', 'Read a text file'],
    ['write --uri <uri> --content <text>', 'Write a text file'],
    ['stat --uri <uri>', 'Inspect file metadata'],
    ['ls --uri <uri>', 'List a directory'],
    ['read-in-mount --mount <id> --uri <uri>', 'Read a text file in a mount'],
    ['write-in-mount --mount <id> --uri <uri> --content <text>', 'Write a text file in a mount'],
    ['stat-in-mount --mount <id> --uri <uri>', 'Inspect file metadata in a mount'],
    ['ls-in-mount --mount <id> --uri <uri>', 'List a directory in a mount'],
  ],
  worktree: [
    ['list [--project <id>]', 'List Git worktrees'],
    ['create --space <id> [--name <branch>]', 'Create a worktree for a space'],
    ['archive --space <id> [--force] [--delete-branch]', 'Archive a space worktree'],
  ],
  session: [
    ['run-agent --space <id> --prompt <text>', 'Launch an agent in a space'],
    ['get --session <id>', 'Inspect an agent session'],
    ['final --session <id>', 'Read the final agent message'],
    ['kill --session <id>', 'Stop an agent session'],
  ],
  pty: [
    ['spawn-in-mount --mount <id>', 'Start a terminal in a mount'],
    ['attach --session <id>', 'Attach to a terminal session'],
  ],
  plugin: [
    ['guide', 'Read the plugin development and usage guide'],
    ['list', 'List installed plugins'],
    ['install <directory>', 'Install a plugin from a local directory'],
    ['install-git <repository>', 'Install a plugin from a Git repository'],
    ['source <id>', 'Inspect the plugin source'],
    ['check <id>', 'Check for a plugin update'],
    ['update <id>', 'Prepare a plugin update'],
    ['apply <candidate-id>', 'Apply a prepared plugin update'],
    ['rollback <id> <revision>', 'Restore a previous plugin revision'],
    ['discover [--query <text>]', 'Find available plugins'],
    ['details <id>', 'Inspect plugin metadata'],
    ['run <id> <command>', 'Run a plugin command'],
    ['open <id> --project <id>', 'Open a plugin window in a project'],
    ['windows <id>', 'List plugin windows'],
    ['skill <id> <skill>', 'Read a plugin skill'],
    ['reload <id>', 'Reload a plugin'],
    ['enable <id>', 'Enable a plugin'],
    ['disable <id>', 'Disable a plugin'],
    ['uninstall <id>', 'Uninstall a plugin'],
  ],
}
export const legacyGroups = Object.keys(legacyHelp)

export const commandExamples: Record<string, string[]> = {
  ping: ['opencove ping', 'opencove --user-data ./profile ping'],
  status: ['opencove status', 'opencove status --pretty'],
  'project list': ['opencove project list', 'opencove project list --fields id,name -o table'],
  'space list': ['opencove space list', 'opencove space list --project project-123'],
  'space get': [
    'opencove space get --space space-123',
    'opencove space get --space space-123 --pretty',
  ],
  'node list': [
    'opencove node list --space space-123',
    'opencove node list --worker local --branch main --kind note',
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
  'api ops': ['opencove api ops', 'opencove api ops --kind query --contract schema'],
  'api schema': [
    'opencove api schema node.create',
    'opencove api schema system.operation.describe --pretty',
  ],
  'api call': [
    'opencove api call project.list',
    'opencove api call node.create --input-file ./new-note.json',
  ],
}
