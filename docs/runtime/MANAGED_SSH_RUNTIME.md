# Managed SSH runtime

Managed SSH owns the installation and lifecycle of an explicitly registered remote deployment.
Manual endpoints remain administrator-managed. An SSH alias is a route, not a deployment identity.
The existing endpoint ID maps to the same remote profile; upgrades preserve credentials and mounts.

## Identity and ownership

The requesting Desktop supplies a validated `RuntimeBuildIdentity` through endpoint prepare/repair.
The intermediate Local Worker must preserve that target. The operation owner freezes it and includes
it in deduplication. The build embeds the identity in Desktop, Worker and renderer and emits
`out/main/runtime-build.json` for side-effect-free CLI inspection.

`buildId` hashes source, dependency lock, build scripts and patches with normalized checkout line
endings. It identifies shared source, not a platform archive. Archive SHA256, platform, architecture
and native runtime validation identify the actual installable artifact. A package version alone
does not identify a development build. Stable/nightly targets are pinned; unknown builds fail closed.
Stable builds with the same version but different identities conflict. A newer active release or
data schema is never automatically downgraded. Protocol compatibility is not inferred from semver.
The journal retains superseded build IDs so an older development client cannot repeatedly reactivate
a build that another client already replaced.

State owners:

| State | Owner | Durable source |
| --- | --- | --- |
| Endpoint, credential and mounts | Existing topology owners | Existing topology/secrets files |
| Requested target and local SSH operation | ManagedSshEndpointOperationOwner | Explicit client intent; generation fences local results |
| Verified runtime files | Standalone publisher | Immutable archive-digest directories |
| Active/previous runtime and activation phases | Deployment controller | Per-deployment SQLite journal |
| Accepted commands and live sessions | Worker maintenance and terminal owners | Actual runtime observations, never UI connection count |
| Display status | Renderer projection | Refreshed operation and endpoint overview |

## Installation

The installer verifies SHA256 for remote and local input, extracts into a unique directory on the
installation filesystem, verifies the bundled Node, native modules and build descriptor, then
publishes a digest directory. A repair publishes a separate directory if the existing one is damaged.
It never removes a runtime that a Worker might still reference. Launchers pin the resolved version
directory so lazy imports and PTY children cannot move to a newer version mid-session.

Managed launchers live under the deployment state directory, separately from an administrator's
global `opencove` command. Shared immutable artifacts do not imply shared profiles or credentials.
Public launchers are replaced atomically after verification. Installation does not require a Windows
symlink or administrator privileges.
If the remote host cannot download a pinned release, the connecting host downloads that same archive,
checks it, and transfers it over SSH. Partial local downloads are removed; checksum failures never
fall back to an unverified build.

## Activation and recovery

The controller is an on-demand process invoked by the CLI, not another permanent daemon. Its
application policy owns transitions; infrastructure owns SSH, filesystem, native DB and process I/O.
An activation-lock SQLite database holds an OS process lock while a separate journal database commits
phases. Process exit releases the lock; PID reuse and elapsed-time guesses do not grant ownership.
These databases require a local filesystem supporting SQLite locking.

The Worker grants maintenance only when no accepted operation or live/pending terminal session exists.
An idle shell and a standby Agent are still live work. Admission freezes synchronously with the idle
decision. Maintenance calls require the expected instance ID and operation lease. The Worker stops
itself through its graceful disposal path; the controller does not kill a PID inferred from a port.

After the old Worker releases its profile, the controller snapshots persistent files and uses the
SQLite backup API to capture committed WAL content. Migration preflight uses a separate snapshot copy.
Managed startup rejects schema downgrades and migration/corruption recovery that would replace data
with an empty database. Ordinary local startup retains its existing recovery policy.

A candidate starts with business ingress closed. The controller validates build, deployment,
authentication, readiness and instance state, commits `active`, then explicitly opens ingress.
Lost activation acknowledgements reconcile against the journal. A migration/start failure retains the
profile, snapshot and `recovery_required` state. Retaining the old binary does not authorize writing an
upgraded database with it or restoring an old snapshot over newly accepted writes.

Legacy Workers that cannot prove deployment identity or maintenance admission require an explicitly
arranged safe stop. Credential rejection is reported separately; generated remote tokens never replace
the Desktop's stored credential. Closing Settings cancels observation only. Local SSH cancellation does
not claim the remote transaction was cancelled; the next explicit prepare reconciles durable state.

## Development artifacts

Build a native standalone bundle on the target platform with `pnpm build:managed-ssh`. It writes the
archive, checksums and installers into `release/managed-ssh/<buildId>`. Development Desktop discovers
that exact directory. Set `OPENCOVE_MANAGED_SSH_ARTIFACT_DIR` to explicitly choose another artifact
directory. A missing or different build reports setup requirements and never falls back to historical
`~/opencove` or `~/opencove-wsl-deploy` files.

For cross-platform JS development with unchanged dependencies, a checksummed matching standalone
distribution can supply the target native runtime:

```sh
pnpm build:managed-ssh --base-directory <release-assets> --platform linux --arch x64
```

The overlay checks declared dependencies and every direct resolved package version, retains target
Node/native files, replaces current built application/CLI files, and creates a new development archive.
It never copies Windows `node_modules` into Linux. The remote installer still performs native checks
before publication. A dependency mismatch requires a new native target build.
On Windows, Unix overlays use WSL to preserve executable modes from the original distribution.
Set `OPENCOVE_WSL_DISTRIBUTION` when the required distribution is not the default one.

## Verification

Policy and admission unit tests cover identity, downgrade prevention, command races and stale leases.
Native contracts exercise OS-backed locks, committed WAL snapshots and strict schema refusal.
Bootstrap integration tests execute generated POSIX/PowerShell scripts with isolated CLI fixtures;
they are not substitutes for actual archive installation and Worker/session smoke tests. Release
verification must run the bundled Node with SQLite and PTY on each supported target platform.
For an explicitly selected SSH test host, set `OPENCOVE_TEST_MANAGED_SSH_HOST` and
`OPENCOVE_MANAGED_SSH_ARTIFACT_DIR`, then run
`pnpm exec vitest run tests/integration/topology/managedRuntime.ssh.spec.ts`. The test creates a unique
deployment, exercises directory access, PTY output, maintenance refusal while busy and instance reuse,
then gracefully stops only that test deployment.
