# Plugin scope and roadmap

This document is the current scope map. Historical design sketches are not API
contracts. Use [README](./README.md) as the entry point and the reference shipped
by `opencove plugin guide` for the host version being targeted.

## Product decisions

- Plugins are independently installed packages. The application does not bundle
  experimental validation plugins. Examples shipped in the guide are source
  templates, not preinstalled features.
- IDs are installation-wide lowercase slugs; no publisher namespace is required.
  Conflicting IDs fail instead of replacing another installation.
- Backends have full Node permissions on their runtime machine. Separate processes
  provide lifecycle and failure isolation, not an OS permission sandbox.
- A plugin chooses whether it has a window. A single-instance window is unique
  across projects on one Worker; a multiple-instance window requires an explicit
  node for commands. Creation always requires an explicit project.
- Documentation and tutorials live in Settings → Plugins. A dedicated
  “Create OpenCove” role, creator launch button and creation-run records are
  deliberately outside the current implementation scope.
- Development API changes are allowed before a stable release. Formal compatibility
  promises apply to published stable contracts, not an unfinished design draft.

## Supported foundation

| Area | Public surface |
| --- | --- |
| Runtime | Independent local directory, immutable installed snapshot, trusted Node backend, enable/disable/reload/uninstall |
| Canvas | Host-owned title/icon/frame, resize, drag, collapse/restore, close and persisted geometry |
| Commands | Backend commands without windows; addressed real-window commands with explicit client selection |
| Skills | Packaged instructions, readable content and a copyable installation prompt |
| Management | Installed list, Markdown details/images, opt-in interactive preview and independent creation-entry preferences |
| Authoring | Offline version-matched guide, runnable source example, design baseline and verification workflow |

## Host integration and distribution

[Host extensions](./HOST_EXTENSIONS.md) defines the command-menu locations,
validated preference schema, SDK access and theme-token contributions. These are
fixed public contracts. They do not authorize arbitrary edits to host DOM, CSS,
internal components or application state.

[Distribution](./DISTRIBUTION.md) defines Git installation, source inspection,
updates, conflict candidates, explicit build choices and retained code revisions.
The installation manager remains the only publisher of an active revision.
An update must preserve personal source changes and must not silently reset or
stash the user's checkout. Failed preparation or publication must leave the old
active version usable. Reverting code does not revert plugin data or external
side effects.

Community discovery is a lightweight GitHub repository search. It does not install
search results automatically, certify compatibility, rank reviewed publishers or
provide a hosted marketplace. Installation still requires choosing a repository.

## Remaining work

1. **Remote execution routing.** Desktop and Web share the connected Worker's
   catalog and backends. Selecting a Space bound to another machine does not yet
   relocate an independent plugin backend. A future target-aware API must keep
   installation location, file ownership and execution machine explicit.
2. **Additional host capabilities.** Public filesystem, terminal and Agent facades,
   richer lifecycle events, Sidebar contributions and long-running cancellable
   operations need separate contracts. Add capabilities for demonstrated needs;
   full Node access does not imply a stable API for host internals.
3. **Distribution maturity.** Publisher/repository metadata, compatibility
   filtering, authenticated/private discovery, artifact cleanup and richer source
   collaboration can build on the current Git lifecycle. Preserve explicit source
   provenance, user modifications and failed-candidate diagnostics.
4. **Release compatibility.** Before the first stable plugin contract, define
   supported host/API ranges, platform coverage, data migration expectations and
   deprecation policy. Current API-version checks reject unsupported versions.
5. **Optional Skill management.** Provider-aware installation/update is separate
   from reading or copying packaged instructions. The current host does not edit
   Agent configuration automatically.
6. **Mobile and local-device integrations.** Responsive Web UI is useful today;
   native mobile execution and a separate client-device extension runtime are
   future work, not implied by Worker-side Node access.

## Acceptance approach

- Validate manifests, selectors and durable-state invariants at unit/contract level.
- Exercise actual local Git repositories for dirty edits, merges, conflicts,
  failed activation/publication, stale candidates, restart and code rollback.
- Exercise real Desktop/Web surfaces for window lifecycle, menu dispatch,
  preference editing, theme fallback and the documentation reader.
- Keep a fresh-Agent authoring trial that starts with `opencove plugin guide`;
  test operational Skills with the intended runtime and explicit project/node/view.
- Run core and affected checks for local commits. Full regression belongs to PR CI
  on the integrated revision. A targeted pass is not a full-suite pass.
