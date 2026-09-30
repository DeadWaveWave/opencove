# Install, use and keep your work

Start with a plugin directory from an author you trust. It must contain
`opencove.plugin.json` and ready-to-run files. OpenCove does not install package
dependencies or run build scripts for you.


## Install from a Git repository

In **Settings → Plugins**, choose **Install plugin → Git repository**. Paste the
repository URL and choose **Install plugin**. Optional settings let you choose a
branch, tag or commit and a plugin directory inside the repository. This form
installs ready-to-run files; packages requiring a build use the explicit CLI
build options in [Git distribution](../DISTRIBUTION.md).

**Discover** searches public GitHub repositories. Inspect a result, then choose it
to fill the repository field. Choosing a result does not install anything.

For a Git installation, the detail page offers **Check for updates**. Review the
result and choose **Apply update** when ready. Updates merge in a separate working
copy and keep the active version until validation succeeds. Conflicts leave a
candidate directory for inspection. After success, check the new source path in
the detail page; the previous working copy remains untouched.

**Previous versions** restores a saved code revision. It keeps your data; it does
not restore older user data. See [Git distribution](../DISTRIBUTION.md) for builds,
conflict resolution and command examples.

## Connect to the intended OpenCove

Keep your intended app or Worker running. In a terminal, check the installation list:

```sh
opencove plugin list --pretty
```

The CLI and running app must support the same plugin API. If the CLI is missing,
use **Settings → Connections → CLI → Install CLI**. For a stopped or separate
development runtime, follow [Authoring and verification](../AUTHORING.md#starting-a-matching-development-runtime).
Keep the same profile or endpoint; do not substitute another running instance.

## Install a directory

Use the absolute path to the plugin on the connected runtime's machine:

```sh
opencove plugin install /absolute/path/to/your-plugin --pretty
opencove plugin list --pretty
```

Open **Settings → Plugins** and refresh the list if needed. Select the plugin to
read its README, check its version and try its preview. A local directory is not
uploaded to a remote Worker.

## Open it where you work

Return to a project canvas and use the plugin's action-bar or right-click entry.
Only packages that declare a view offer those entries. A plugin can also provide
commands or Skills; their instructions appear on its detail page.

The detail switches under **Show in** hide individual shortcuts without stopping
existing windows. Use the plugin's enable switch to stop or resume the plugin itself.

## Apply your source changes

After editing or rebuilding the source directory, load the new files explicitly:

```sh
opencove plugin reload your-plugin
opencove plugin details your-plugin --pretty
```

Replace `your-plugin` with the manifest ID. Check the resulting revision and logs.
An invalid candidate leaves the previous working version active. Source control
belongs to your source directory; a reload does not merge Git changes for you.

## When something goes wrong

Open the detail page for runtime errors and logs. If a preview is unavailable,
the plugin may simply not declare one. If a window is unavailable, check whether
the plugin is installed and enabled. A disabled plugin's data and saved windows
remain available when it is enabled again.

[Continue with the Hello Clock tutorial](./BUILD.en.md) or read the
[full authoring guide](../AUTHORING.md#debug-and-iterate).
