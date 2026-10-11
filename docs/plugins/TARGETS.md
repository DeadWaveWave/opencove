# Project targets and host operations

A plugin backend runs on its installation Worker. A project or Space can refer
to another machine. Use the host API when the operation belongs to that project;
direct Node filesystem and process APIs still run on the backend's own machine.

The same facade is available as `window.opencovePlugin.host` in a real view and
as `host` in `activate({ host })`. Call it from view actions or backend
`invoke`/`runCommand` handlers, after activation. Host requests during activation
are rejected because the candidate has not been published. A declared backend
command can use the facade without creating or opening a window.

## Select a target explicitly

```js
const catalog = await host.target.list()
// catalog.projects: [{ id, name, spaces: [{ id, name }] }]
// Populate selectors; wait for the user to choose before resolving/executing.
const target = { projectId: 'chosen-project-id', spaceId: 'chosen-space-id' }
const resolved = await host.target.resolve(target)
```

`list()` is read-only and returns saved projects and their Spaces on the connected
Worker. An empty installation returns `{ projects: [] }`. The list does not
select a default, prove a target is online, or expose connection credentials.
Resolve the chosen selector to check its current mount. The response is capped
at 1 MiB; an oversized catalog fails explicitly instead of returning a misleading
partial list. Previews must supply their own sample catalog.

`projectId` is always required. `spaceId` is optional; when present it must belong
to that project. The Space's mount and working directory determine execution.
Omitting Space selects the project's default directory. Visual nesting does not
select another Space's directory.

Keep the selector separate from the resolved result. Subsequent requests accept
only `{ projectId, spaceId? }`, not the returned object with mount/endpoint fields.
Omit `spaceId` when unused; do not send `null`. Every new request resolves the
selector again; an already-started operation retains its admitted target.

Resolution returns `projectId`, `spaceId`, `mountId`, `endpointId`, `rootUri`,
`cwdUri` and `workingDirectory`. These describe the target machine, which may
differ from the viewer or plugin backend. Show this location before executing.
Do not infer the current project, construct a local path from a remote path, or
substitute another machine after a connection error.

Use `opencove project list` to find project IDs. A menu command can use the
explicit project/Space context supplied to its handler. A CLI command should
accept the selection in its declared parameters. Resolve again after a deliberate
selection change; IDs identify host objects, not permanent path aliases.

## Read files on their owning machine

```js
const listing = await host.filesystem.readDirectory({ target, path: '.' })
const document = await host.filesystem.readText({ target, path: 'README.md' })
```

Directory results contain `{ target, entries, truncated }`. Each entry contains
`name`, `uri` and `kind` (`file`, `directory` or `unknown`). Text results contain
`{ target, content }`. In both, `target` is the resolved target described above.
Use relative entry paths for subsequent requests, not the returned absolute URI.

Paths are relative to the resolved working directory. The host validates scope
and routes through its existing filesystem/mount services. Requests outside the
supported scope fail. The APIs do not upload local files or copy remote projects
onto the viewing computer. Text reads are bounded to 1 MiB and directory listings
to 1,000 entries. Show empty, unavailable and oversized states honestly.
Current filesystem providers enforce these limits while reading. Older remote
Workers may only be bounded when their response reaches this host; upgrade those
Workers before relying on provider-side limits for very large directories/files.

## Start, observe and cancel work

```js
const operation = await host.operations.start({
  target,
  command: 'git',
  args: ['status', '--short'],
  timeoutMs: 30000,
})
const current = await host.operations.get({ operationId: operation.operationId })
await host.operations.cancel({ operationId: operation.operationId })
```

`command` and `args` are separate; shell expansion and pipelines are not inferred.
An explicit shell is needed only when a plugin intentionally requests shell
semantics. Available executables are those on the target machine.

Start returns promptly with an operation handle. Poll while its owner remains
alive and stop at a terminal status. Results include `operationId`, `target`,
`status`, `output`, `truncated`, `exitCode` and `error`. Status is `starting`,
`running`, `cancelling`, `completed`, `cancelled` or `failed`. Cancellation remains
`cancelling` until termination is observed; it must not be presented as completed
merely because a stop request was sent. Inspect the exit code before reporting
success: `completed` means the process ended, including nonzero exit codes.
`cancelled` can carry exit code zero and must still be reported as cancelled.
Start with a 500 ms polling interval and stop polling at a terminal status.
Output is combined terminal output and may contain ANSI control sequences,
not separate stdout/stderr streams.

Timeout defaults to 30 seconds; `timeoutMs` accepts integers from 100 to 120,000.
Output is bounded
to 256 KiB. Each owner has at most four active operations and 64 retained records;
the runtime retains at most 256 records. Handles are transient and do not survive
Worker restart. Do not automatically retry an uncertain start: inspect the handle
you received first. A timeout does not undo external side effects.

## Ownership and previews

Operations belong to the calling view or backend generation. Closing a view ends
work started through that view's facade; collapsing keeps it alive. Closing one
window does not end independent work owned by the shared backend. Disable,
reload, uninstall and backend failure retire that backend's work. A stale handle
cannot control another owner's process.
Remote terminal-session history follows that Worker's existing retention policy;
retiring an operation is not a remote-history deletion command.

Previews cannot use these project operations. Provide clearly labeled sample
results instead of accessing real files or starting processes when details open.
Full Node access remains a trust relationship, not a sandbox: a preview backend
must also refrain from direct external work itself.

## Commands and Skills

```js
export function activate({ host }) {
  return {
    async runCommand(commandId, params) {
      if (commandId !== 'inspect') throw new Error('Unknown command')
      const target = { projectId: params.projectId }
      if (params.spaceId) target.spaceId = params.spaceId
      return host.filesystem.readDirectory({ target, path: '.' })
    },
  }
}
```

Declare the command with `target: "plugin"` and use the existing
`opencove plugin run <id> inspect --params <json>`. Validate your own parameters.
Skills must retain the intended runtime/profile and select explicit project/Space
IDs, then read back the real result. Do not invent additional CLI verbs, import
private host modules, or copy connection tokens into a plugin.

## Scope

These APIs route supported operations. They do not move arbitrary plugin code to
a remote Worker, install packages on another machine, provide a client-device
Node runtime, or expose arbitrary internal commands. Terminal-window creation,
Agent launching and session controls are available through the routed
[nodes and sessions API](./CANVAS_API.md), with explicit targets and lifecycle
rules described there.

The separation follows [VS Code's remote extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions):
host APIs can route to a workspace while direct Node APIs remain bound to their
process. OpenCove resolves each explicit project/Space through the mount owner,
rather than inferring a single globally active project.
