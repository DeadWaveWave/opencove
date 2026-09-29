## Your repository, beside your work

Git Board brings repository status and a vertical commit history into a window on your canvas. Keep it beside your Agent, terminal, or files while you work.

### Open a board

1. Open a project or Space connected to a Git repository.
2. Choose **Git Board** from the canvas right-click menu or the action bar.
3. Use **Refresh** to read the latest state after making changes.

The board follows the repository of its target Space, including a connected remote location. Move, resize, or collapse it like any other canvas window.

### At a glance

| In the window | What it tells you |
| --- | --- |
| Branch | The repository's current branch |
| Working tree | Whether it is clean, or how many files changed |
| Ahead / behind | Commits relative to the upstream branch |
| History | Recent commits, hashes, and commit messages |

![Illustration of a vertical commit history connected to a canvas window](./overview.svg)

Git Board currently reads repository state. It does not commit, switch branches, or change files.

### Make the window yours

Drag the header to move it. Drag an edge or corner to resize it. Collapse the window to keep a compact icon on your canvas, then click it to expand again. Its position, size, and collapse state are saved with the workspace.

Disabling the plugin keeps existing windows and their configuration. Re-enable it in **Settings → Plugins** to restore their content. The built-in version updates with OpenCove.

### Build on this idea

Ask your Agent to run:

```sh
opencove plugin guide
```

The command returns the plugin documentation README and its directory. The guide describes the current extension points and the features still being developed.

Learn more about [Git history](https://git-scm.com/docs/git-log).
