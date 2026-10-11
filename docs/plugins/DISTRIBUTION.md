# Git installation, personal source and code rollback

Use the CLI and guide from the same build as your selected Worker. Distribution
commands operate on that Worker: Git paths, editable checkouts, build tools and
credentials belong there. They do not upload the CLI machine's files or start a
replacement Worker. Follow the profile and endpoint selection in [Commands and skills](./COMMANDS.md).

## Install and inspect

A repository must contain an API 1 package or an explicit build that produces one.
Installation executes trusted code; review its source before installing. Repository
credentials come from Git's configured SSH/credential mechanisms, not URL passwords.

```sh
opencove plugin install-git https://github.com/example/plugin.git --ref v1.0.0
opencove plugin source plugin-id
opencove plugin details plugin-id
```

`--ref` accepts a branch, tag or full commit ID; omission resolves the remote default
branch. A branch and tag sharing a name require `refs/heads/name` or `refs/tags/name`.
Revision expressions and shell commands are not supported. Installation records the
exact resolved upstream commit. It does not follow a moving branch automatically.
An absolute local Git repository path, including spaces, is also supported.

`--directory packages/plugin` selects the package directory relative to the repository.
The default is `.`. The default build is `none`: the repository must already contain
runnable, bundled files. `plugin source` returns the editable source directory,
tracked upstream ref and commit, current checkout commit and dirty state, retained
code history, and unresolved or failed candidate directories. Paths are Worker-local.

The editable checkout is yours. Commit, edit and inspect it normally. Its files are
separate from immutable running artifacts; editing source does not hot-reload code.
Local directory installation remains available as `plugin install <directory>`.

## Explicit builds

```sh
opencove plugin install-git https://github.com/example/plugin.git \
  --ref main --directory packages/plugin \
  --build npm --script build --output dist
```

Build strategy belongs to this installation, not the plugin's runtime manifest.
Supported strategies are `none`, `npm` and `pnpm`. Script defaults to `build`, output
to `.` relative to the package directory. An npm build requires `package-lock.json`
and runs `npm ci --ignore-scripts --no-audit --no-fund`; pnpm requires
`pnpm-lock.yaml` and runs `pnpm install --frozen-lockfile --ignore-scripts`.
Then the selected package script runs explicitly. Package-script pre/post hooks may
run as part of that explicit script. Dependency lifecycle scripts remain disabled.
Build scripts and dependencies must be trusted: they have ordinary process and
filesystem access, not a sandbox. No host application dependencies are installed.

Tools must already exist on the Worker. The existing executable resolver finds
npm/pnpm and Node. Standard Windows npm, pnpm and Corepack launchers use their
JavaScript entry with Node instead of constructing a shell command. Unrecognized
Windows wrappers produce an actionable error; prebuilt packages remain available.
Native build dependencies and unusual monorepo installation strategies may require
an author-provided prebuilt package. The host does not guess a build system.

Git steps have a two-minute deadline; each dependency-install and build step has
three minutes. CLI Git mutations and reload use a ten-minute request timeout unless
`--timeout` overrides it. A request timeout is not proof that publication failed:
read `plugin source` and `plugin details` before taking another action.

## Check, update, resolve

```sh
opencove plugin check plugin-id
opencove plugin update plugin-id
opencove plugin update plugin-id --ref refs/heads/main
```

Check reads the remote ref and reports the recorded/current available commit. It
does not change the source checkout, active revision or user data. Update is explicit:

1. Clone the current editable source into an isolated candidate.
2. Preserve personal commits and snapshot tracked working changes, staged deletions
   and nonignored untracked files in that candidate. The original index and files
   stay untouched. Ignored files such as `node_modules` are not personal source.
3. Fetch the exact requested upstream commit and merge it into the candidate.
4. Build there, validate a new immutable artifact and activate its candidate backend.
5. Recheck source identity and active generation; atomically publish the registry.
   Only then retire the previous active generation and its view leases.

Success returns the **new editable source directory**. Future edits/reload/update
use that directory. The previous source checkout remains intact, including its dirty
files; it is not silently reset or stashed. Always read the returned source path
before editing again. `plugin reload plugin-id` rebuilds a snapshot of current personal
source without fetching a newer upstream commit.

A merge conflict returns `status: "conflict"`, candidate ID and directory. Validation,
build or activation failure returns `status: "failed"` with its error and retained
candidate. Neither result replaces the active version. Read the status field even
when the transport itself returned successfully. The CLI prints the recovery JSON and
exits with status 1 for both failed and conflicting outcomes.

Resolve conflicts and commit the resolution in the reported candidate, then:

```sh
opencove plugin apply candidate-id
```

Apply revalidates and rebuilds; it does not trust the earlier validation result.
It rejects a candidate if its original source changed or if the installation was
reloaded, disabled/re-enabled, uninstalled/reinstalled, or the Worker restarted.
Prepare a new update from the current source and deliberately carry any reviewed
resolution over; no automatic replay or overwrite occurs. Unresolved source checkout
conflicts must be resolved before preparing an update. Symlinks and submodules in
source snapshots are unsupported. Source snapshots are bounded to 5000 files,
64 MiB total and 16 MiB per file; published artifact limits remain unchanged.

## Code rollback

```sh
opencove plugin source plugin-id
opencove plugin rollback plugin-id exact-retained-artifact-revision
```

Rollback republishes a retained immutable artifact, reactivates its code and restores
its recorded editable source pointer. It does not rebuild or fetch. Up to twenty
previous code versions remain in the installation's history. Source directories,
artifacts and failed candidates are retained; uninstall does not delete them or
private data. There is no automatic garbage collection in this version.

**Rollback is code-only.** It does not reverse saved plugin data, database migrations,
network operations or side effects performed by a build or candidate activation.
Candidate startup may overlap the old backend and shares private data. Authors must
keep startup and disposal safe for overlap and maintain data compatibility with the
still-active version. A failed candidate can have produced external side effects even
though the active registry and old process were preserved.

## Discovery

```sh
opencove plugin discover --query notes
```

Discovery queries public GitHub repositories with the `opencove-plugin` topic and
returns at most twenty names, URLs, descriptions and popularity/update metadata.
This is a search result, not a curated or verified catalog. It does not clone,
install, execute, or update anything. Explicit installation and source review remain
separate. GitHub rate limits and unavailable network access are reported as errors.

## Ownership and failure rules

| State | Owner | Publication and recovery |
| --- | --- | --- |
| Editable source and preserved personal files | User; managed Git directory allocation by `GitPluginSources` | Never reset/stash the old checkout; new successful candidate path is explicit |
| Merge/build candidate and diagnostics | Distribution service and Git infrastructure | Retained after conflict/failure; revalidated for manual apply |
| Immutable runnable artifact | `LocalPluginFiles` | Separate from mutable source/build outputs |
| Enabled intent, source pointer, active artifact and history | `PluginInstallationManager` | One serialized mutation owner and atomic installed registry |
| Backend, view generations and commands | Existing runtime owners | Old generation stays active until publication; no command replay |
| Plugin data | Existing plugin storage/backend | Independent from code history; not transactionally rolled back |

The design follows Git's separation of working trees and commit history, its warning
about merging with dirty worktrees, and explicit fetch/merge behavior:
[Git worktrees](https://git-scm.com/docs/git-worktree),
[Git merge](https://git-scm.com/docs/git-merge),
[Git fetch](https://git-scm.com/docs/git-fetch).

## Settings maintenance and repository details

Settings → Plugins → Install exposes the same explicit Git inputs as the CLI: a
repository, ref, package directory, and optional `npm` / `pnpm` build script and
output directory. No build strategy is inferred from a repository. An installed
plugin's source controls can check a different ref before explicitly applying it.
Changing the ref clears the previous check result.

Failed/conflicting update candidates appear in the plugin's details, with the
Worker-local working directory, copyable resolution instructions, and an explicit
**Apply resolved candidate** action. Failed initial installations retain their
candidate in the install panel for the same recovery flow. Closing that panel does
not remove the candidate; its returned ID/path can still be used with the CLI.
Source and registry owners remain authoritative: UI never resolves conflicts, resets
files, or edits the active registry itself. A candidate whose installation generation
or original source fingerprint changed is shown as stale and cannot be applied from
Settings. Backend revalidation remains mandatory even when a displayed candidate
looks current. Preparing a fresh update is the recovery path; retained files are not
automatically discarded.

Discovery results open a read-only repository detail before installation. The Worker
reads the public GitHub repository metadata, resolves its default branch to one
commit, and reads its README and root `opencove.plugin.json` at that exact commit.
The view displays declared version/platform requirements, not a certification of
compatibility. A missing/invalid root manifest does not prove the repository is not
a plugin: it may need an explicit package directory or build. The next install form
starts with the reviewed commit pinned; users can deliberately choose another ref.

This inspection never clones, builds, activates a backend or executes an interactive
preview. README HTML is ignored. Relative document links and images resolve inside
the reviewed repository and commit; unsafe schemes and escaping paths are rejected.
HTTPS documentation images are rendered without a referrer. GitHub requests do not
carry credentials, reject redirects, have a ten-second timeout per request, and bound
streamed JSON to 1 MiB (README envelope 512 KiB, manifest envelope 128 KiB). Decoded
README and manifest limits are 256 KiB and 64 KiB. Network/rate-limit errors stay
visible with a retry action; they never trigger an installation.

Content inspection follows the public [GitHub repository contents API](https://docs.github.com/en/rest/repos/contents).
