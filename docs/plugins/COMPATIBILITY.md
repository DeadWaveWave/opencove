# Plugin compatibility and release policy

The plugin contract is still **development API 1**. A host version requirement is
an installation check, not a declaration that this API is stable. Use the guide
shipped with the Worker being targeted (`opencove plugin guide`) and record the
exact tested OpenCove build in the plugin's README during development.

## Manifest declarations

```json
{
  "apiVersion": 1,
  "engines": { "opencove": ">=0.3.2 <0.4.0" },
  "platforms": ["darwin", "linux", "win32"]
}
```

These are optional additions to a complete manifest, not a complete plugin.

| Declaration | Meaning |
| --- | --- |
| `apiVersion` | Required protocol generation. This build accepts exactly `1`. It does not promise all development builds expose identical capabilities. |
| `engines.opencove` | Optional npm SemVer range for the OpenCove **Worker** that owns the installation. Examples: `>=0.3.2 <0.4.0`, `^0.3.2`, or `^0.3.2 || ^0.4.0`. |
| `platforms` | Optional supported Worker operating systems: `darwin`, `linux`, `win32`. Omission keeps the existing all-platform behavior. |
| `version` | Plugin release version, independent of both host version and API generation. |

Existing API 1 packages without `engines` remain loadable. This omission means
there is no declared host range; it does **not** certify compatibility. An explicit
range cannot be checked against an unknown host version and is rejected with an
actionable error. The host version comes from the running Worker, never from the
plugin, a selected project, a browser's user agent or the desktop client version.

Ranges use npm SemVer's normal prerelease rules. A range such as
`>=0.3.2 <0.4.0` excludes `0.3.3-nightly.5`; authors testing that prerelease can
explicitly include it, for example `>=0.3.3-nightly.1 <0.3.3`. Build metadata does
not change version precedence. Two development builds with the same version may
still differ in development APIs; this version gate does not compare commits or
replace testing against the bundled guide.

There is no architecture (`arm64`/`x64`) declaration or client-device capability
negotiation yet. Plugins with native dependencies must state their tested
architectures in their documentation. A supported Worker OS does not imply that
browser-specific APIs, native mobile APIs, codecs or system commands are available.
Native mobile execution is not supported. Desktop and Web clients share the
connected Worker's installed plugin; they do not gain Node access in their renderer.

## Admission, recovery and ownership

Manifest normalization validates the declaration. `LocalPluginFiles` checks host
version and platform before publishing a new immutable artifact and when restoring
an installed or retained artifact. `PluginInstallationManager` remains the sole
owner of enabled intent, active revision, source pointer and code history.

The same checks therefore apply to directory installation/reload, Git installation,
update/apply, restart and code rollback:

1. An incompatible candidate never replaces the active artifact or starts its
   plugin backend. Its error identifies the requirement, actual host and recovery
   action. Git candidates remain available for inspection and correction.
2. Restart incompatibility records an error for that plugin while preserving its
   enabled intent, registry entry and private data. Other compatible plugins can
   still start. Returning to a compatible host lets the retained artifact load.
3. Rollback checks the retained code against the **current** host. A historical
   artifact is not automatically compatible just because it ran in the past.

Git build commands run before an artifact can be validated. They have the invoking
user's permissions and may have external side effects. Version checks are not an
OS sandbox or a transactional rollback of build commands. See
[Distribution](./DISTRIBUTION.md) for source/candidate behavior and
[Runtime](./RUNTIME.md) for process and preview ownership.

## Plugin data and schema changes

Code history and user data have separate lifecycles. The host retains plugin data
across reload, disable, uninstall and code rollback; it does not own a plugin's
application schema and does not automatically migrate or downgrade it.

Authors own their schema version and migrations in their private data directory or
storage values. Before changing persistent data:

- Keep the old code able to read data written while an update candidate is starting.
  Candidate activation can overlap the active backend and share private data.
- Make migration steps idempotent and restart-safe; serialize writes or use the
  database's transaction/locking mechanism. Back up data before irreversible work.
- Detect newer unsupported schemas and fail with recovery instructions instead of
  overwriting or silently resetting user content.
- Test failed activation, interrupted migration, restart and code rollback with
  existing data. If rollback cannot read the new schema, document a separate data
  recovery procedure. Do not advertise code rollback as data rollback.

The host does not yet provide a migration callback, data-version negotiation or
transaction spanning plugin activation and private storage. These are explicit
limits, not implied guarantees of `apiVersion` or `engines`.

## Before the first stable plugin API

Development-branch contracts may still change. Mark those changes and update the
guide, SDK declarations and examples together; do not call a development contract
stable merely because the application itself ships a release.

Before publishing a stable plugin contract, release review must establish:

1. The documented public API surface and first stable API generation, supported
   host range, desktop/Web behavior and Worker OS test matrix.
2. Upgrade tests for older published packages and persisted plugin data, including
   failed updates, restart and rollback. Desktop/Web or cross-platform support
   must be reported only for environments actually exercised.
3. A documented replacement and migration path for any deprecated API. Once a
   stable API generation is published, compatible additions stay in that
   generation; removal or changed semantics requires a new API generation and an
   explicit transition/release notice. There is no committed deprecation time
   window before the first stable contract is released.
4. A versioned guide available with the host, compatibility errors that preserve
   user data, and release notes that distinguish host requirements from plugin
   code and data versions.

This follows the separation between extension host ranges and package versions in
[VS Code's manifest](https://code.visualstudio.com/api/references/extension-manifest),
[npm engine ranges](https://docs.npmjs.com/cli/configuring-npm/package-json#engines),
and [Semantic Versioning](https://semver.org/). OpenCove enforces a declared range
at plugin admission; unlike npm's default advisory engine checks, incompatible
plugin code is not activated.
