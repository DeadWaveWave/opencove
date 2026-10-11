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
| Project operations | Explicit project/Space targets, routed file CRUD and sampled watches, bounded cancellable execution from real views or backend commands |
| Host control | Node CRUD/focus, terminal and Agent lifecycle, sampled events, own-plugin preferences and declarative Sidebar trees |
| Maintenance | Git build/ref controls, failed/conflict candidate recovery and read-only repository details before installation |
| Themes | Pixel/light inheritance, bundled CSS/assets/fonts, public skin parts, metrics, motion profiles, iframe context and fallback |
| Compatibility | Optional host SemVer range, Worker platform checks, incompatible-candidate rejection and per-plugin restart isolation |

## Host integration and distribution

[Host extensions](./HOST_EXTENSIONS.md) defines the command-menu locations,
validated preference schema, SDK access and theme contributions. [Themes](./THEMES.md)
defines the supported CSS/parts/metrics/motion contract. Internal component
replacement, structural navigation changes and direct application-state mutation
remain outside those public interfaces.

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

1. **Broader remote plugin execution.** [Project targets](./TARGETS.md) route
   supported file, session and process operations to the resolved mount. Desktop and
   Web still share the connected Worker's catalog and plugin backends. Arbitrary
   plugin code is not moved or installed on another machine automatically.
2. **Durable and exhaustive automation.** The [host API map](./HOST_API.md) now
   covers file mutations, sampled watches/events, node/session facades and Sidebar
   contributions. Durable jobs, lossless event replay and specialised creation
   for every existing node kind remain separate work. Current jobs are transient;
   snapshots can coalesce changes. Full Node access does not imply a stable API
   for host internals.
3. **Distribution maturity.** Authenticated/private discovery, broader compatibility
   filtering, artifact cleanup and richer source
   collaboration can build on the current Git lifecycle. Preserve explicit source
   provenance, user modifications and failed-candidate diagnostics.
4. **Stable release acceptance.** [Compatibility policy](./COMPATIBILITY.md)
   now defines host ranges, runtime platform checks, migration expectations and
   deprecation rules. API 1 remains a development contract. First-stable review
   still requires the declared cross-platform matrix and upgrade evidence;
   version checks alone are not a compatibility certification.
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
