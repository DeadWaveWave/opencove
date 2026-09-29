# Authoring and verification

This guide describes the capabilities of the build that returned it. Begin with
`opencove plugin guide` and read its `readme`; do not infer API availability from a
roadmap or from a different OpenCove checkout.

## Determine whether the requested integration exists

The current build supports bundled plugins only. There is no independent package
loader, install/reload command, public SDK entry, or dynamically registered node,
command or preview. `plugin list` reports bundled manifests; a successful response
does not prove a third-party plugin can be loaded.

If independent installation is a requirement, report this runtime limitation
explicitly. Building a working standalone component can validate the product idea,
but modifying OpenCove to import it is host development. Neither a standalone page
nor a website node counts as an installed plugin.

## Work that can be validated before the loader exists

Keep the new component in its own source directory with reproducible development,
build and test commands. Document external services, credentials, platform needs,
network access, data retention and any features that remain unavailable. Do not
publish a made-up OpenCove manifest or SDK as a supported contract.

Separate persistent user data, transient runtime state and presentation:

- A playlist, favorite or preference is user data; identify its storage and scope.
- A running task or media player needs a single owner with explicit cleanup.
- A hidden or collapsed view is presentation state; it must not implicitly destroy
  work that is intended to continue.
- A detail preview uses its own state. It must not change a user's real workspace,
  queue or favorites, or run background work merely because details are opened.

For media features, verify the source's actual playback rights and behavior.
Catalog search, short previews, live radio and full on-demand tracks are distinct
capabilities. Show which one is available and surface unavailable tracks, network
errors and playback restrictions. Do not claim catalog coverage from a few sample
results. Local development and test fixtures must be identified as such.

OpenCove can embed websites, but this is a separate compatibility experiment:
document the URL/server lifecycle and test its real behavior. Website suspension,
snapshotting or close behavior may differ from plugin windows. Verify continuing
audio in the actual host instead of assuming that keeping a DOM child mounted
guarantees continuing playback. Browser playback belongs to the viewing device;
running a backend on a remote Worker does not imply sound plays on that Worker.

## What remains for the host to provide

Before independent authoring can be called supported, the host must ship:

1. A package contract and example with API/version compatibility, declared node
   types, commands, assets, documentation and preview entry points.
2. A loader and explicit install/reload lifecycle, with errors and logs visible to
   both the user and an Agent.
3. A shared registry used by management, creation actions, node rendering and CLI.
4. Version-matched UI resource delivery to Desktop and Web UI, and explicit Worker
   routing for background code.
5. Plugin storage, migrations and disable/re-enable recovery that retain node data.
6. A development template and verification commands that work without editing the
   OpenCove repository.

These are missing runtime capabilities, not names an author should guess or
interfaces a plugin can supply on its own. Full Node access for trusted background
plugins is a planned runtime capability; the current renderer still has no Node
integration.

## Acceptance evidence

Report these separately, with the command or interaction used and actual result:

- **Component:** builds, displays correctly in both themes and performs real work.
- **Host integration:** appears in the plugin registry and management detail page,
  with working declared actions and preview.
- **Installation:** loads from an independent directory without a host source edit
  or rebuild; incompatible versions are rejected with an actionable explanation.
- **Lifecycle:** resize, collapse, expand, close, disable and re-enable have the
  intended effects on work and data; a restart preserves the promised state.
- **Iteration:** changing plugin source and explicitly reloading applies the new
  version; a failed candidate does not destroy the currently working version.

For blocked steps, include the command/error, documentation section consulted and
missing capability. Do not mark the entire integration successful because the
component works in a browser. Keep experiment logs and screenshots outside the
OpenCove source tree; keep reusable developer guidance in this directory.
