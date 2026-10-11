# Plugin filesystem access

Use `host.filesystem` in real views or activated backend handlers. The host
resolves the explicit `{ projectId, spaceId? }` selector on every new request and
routes through the existing filesystem provider on that project's machine.
Direct Node filesystem calls instead run on the plugin backend's own machine.
See [Targets](./TARGETS.md) for selection, routing and unavailable-target behavior.

## Read and mutate

```js
const target = { projectId: selectedProjectId, spaceId: selectedSpaceId }
const info = await host.filesystem.stat({ target, path: 'notes.txt' })
// { target: resolvedTarget, stat: { uri, kind, sizeBytes, mtimeMs } }
await host.filesystem.mkdir({ target, path: 'notes' })
await host.filesystem.writeText({
  target, path: 'notes/today.md', content: '# Today\n', overwrite: false,
})
await host.filesystem.rename({ target, path: 'notes/today.md', newPath: 'notes/archive.md' })
await host.filesystem.delete({ target, path: 'notes/archive.md', recursive: false })
```

All paths are relative to the target's working directory. Absolute paths, parent
traversal and out-of-scope URIs are rejected. Mutation paths must be explicit and
cannot refer to the working directory itself. Rename validates both locations;
it stays within the same target and rejects an existing destination. The provider
uses an existence check before rename; it does not promise an atomic no-replace
transaction against concurrent external filesystem modifications.

`writeText` requires an explicit `overwrite` boolean. `false` exclusively creates
a missing file: an existing file is never truncated, even if two creators race.
`true` creates or replaces the entire file. The UTF-8 content limit is 1 MiB.
Neither writing nor `mkdir` automatically creates missing parent directories.
`mkdir` fails if its destination already exists. Existing `readText` and
`readDirectory` limits remain 1 MiB and 1,000 entries respectively.

`delete` requires an explicit `recursive` boolean. `false` removes a file or empty
directory and rejects nonempty directories. `true` also removes directory contents.
This is permanent deletion, not a recycle-bin request. Ask the user as appropriate
for the plugin's action and show the selected location before destructive work.
Mutation results contain `{ target: resolvedTarget, uri }`; rename returns the
new URI. The host checks caller lifetime after asynchronous approval, target and
capability resolution and before provider/remote dispatch. Retirement at those
waiting points prevents a pending mutation from being sent. A mutation already
dispatched to the filesystem provider or remote Worker before its caller closes
may finish. Cancellation
or an uncertain transport response is not a rollback: inspect disk before retrying.

Explicit write/delete semantics require a target Worker that advertises them.
An older remote Worker fails before mutation instead of ignoring the flags and
silently overwriting or recursively deleting. Existing host callers which omit
these optional underlying provider flags retain their previous behavior.

## Handle file errors

Recognized provider failures expose a `filesystem.*_failed` code and a
`params.reason` value on the thrown SDK error in both the backend and real view:
`not_found`, `already_exists`, `permission_denied`, `not_empty`, `not_directory`
or `is_directory`. Use the reason instead of parsing an English message or raw
OS error. The operation code can reflect a prerequisite: reading a missing file
can fail at `stat` before the read itself. Older remote Workers and unrecognized
failures may omit `reason`; preserve that failure instead of treating it as a
missing file. Provider debug details and arbitrary parameters are not forwarded
to the plugin.

```js
try {
  await host.filesystem.stat({ target, path: 'notes' })
} catch (error) {
  if (error.code?.startsWith('filesystem.') && error.params?.reason === 'not_found') {
    // The caller can explicitly choose to create this directory.
  } else {
    throw error
  }
}
```

## Observe shallow changes

```js
const watch = await host.filesystem.watch({ target, path: 'src' })
// { watchId, target: resolvedTarget, intervalMs: 1000 }
const sample = await host.filesystem.readWatch({ watchId: watch.watchId })
// { watchId, target, events: [{ type: 'created' | 'changed' | 'deleted', path }],
//   truncated, sequence, retryAfterMs }
await host.filesystem.unwatch({ watchId: watch.watchId })
// { watchId, disposed: true }
```

This is **demand-driven sampling**, not a lossless OS event stream. `watch` captures
an initial snapshot; only `readWatch` asks the owning machine for a new sample.
No hidden timer continues polling after the plugin stops consuming. Wait at least
`retryAfterMs` (normally 1,000 ms); earlier or concurrent reads return no events.
Each completed sample increments `sequence`. Returned changes are consumed once.

Event paths are relative to the target working directory, including the watched
path prefix. A directory observation covers that directory and its immediate
children, not descendants; a file observation compares its metadata. Changes
compare kind, byte size and modification time, so a transient create/delete or a
content change with identical metadata can be missed. Rename appears as delete
and create. Do not use these observations as an audit log or synchronization truth.
Symlink/unknown directory entries are not followed during sampling.

Each watch supports at most 256 immediate children; larger directories fail
explicitly. At most four watches may belong to one caller and 32 to the runtime.
A response contains at most 256 events; `truncated: true` means refresh the listing
rather than trying to reconstruct state from the partial batch. There are at most
four concurrent child stat requests per sample. If the watched path itself becomes
unavailable or a sample encounters a concurrent removal, `readWatch` fails and
retains the previous snapshot; choose an existing parent or recreate the watch
as appropriate. Disconnects likewise report failure, never an empty directory.

Handles belong to the calling view or backend generation. Close/unwatch, disable,
reload, uninstall and runtime retirement release the relevant observations.
Collapsing a window preserves its view. A handle cannot be read or disposed by
another caller. Pending sampling cannot publish after disposal; changing a target's
mount/path invalidates the watch instead of silently observing another location.
Worker restart loses handles. Previews must supply sample data and cannot watch
or modify real files.

## Design basis

The [VS Code filesystem API](https://code.visualstudio.com/api/references/vscode-api#FileSystem)
keeps local/remote access behind filesystem providers and makes mutation options
explicit. OpenCove follows that boundary while selecting a project/Space per
request. Its initial watcher uses bounded provider snapshots because the current
Worker protocol does not expose a general OS event subscription; the sampled
semantics above are deliberately narrower than native recursive watching.
