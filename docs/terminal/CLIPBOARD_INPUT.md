# Terminal Clipboard Input

The desktop clipboard boundary reads text and native image presence together.
The terminal clipboard handler owns shortcut routing; the provider CLI owns
reading and attaching the native image. Image triggers are raw terminal input,
never bracketed paste. Text continues through the normal bracketed-paste encoder.

| Provider | Windows image trigger | macOS image trigger |
| --- | --- | --- |
| Pi | Alt+V | Ctrl+V |
| Kimi | Ctrl+V | Ctrl+V |
| Codex | Ctrl+V (also accepts Alt+V) | Ctrl+V |
| Claude Code | Alt+V | Ctrl+V |
| Unidentified TUI, including OMP | Ctrl+V | Ctrl+V |

Native platform paste shortcuts read clipboard content before choosing text or
image delivery. Windows Alt+V is normalized only for an identified supported
provider. Unidentified shells retain their Alt+V behavior. An image pasted with
Cmd+V into an unidentified macOS terminal emits Ctrl+V, which OMP accepts.

Clipboard reads preserve paste order, and late results cannot write after the
terminal session has been disposed. No image files or new durable state are
created. Browser clients retain text-only paste: the remote provider cannot read
the browser machine's native clipboard. Remote desktop sessions likewise cannot
attach local images through a native provider shortcut; file transfer is separate.
Custom provider keybinding overrides are not inspected.

## Upstream References

- [Pi keybindings](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/keybindings.ts): `app.clipboard.pasteImage` defaults to Alt+V on Windows and Ctrl+V elsewhere. Verified against the locally installed official package and its keybindings documentation.
- [OMP keybindings](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/config/keybindings.ts): `getDefaultPasteImageKeys` accepts Ctrl+V and Alt+V on Windows, Ctrl+V and Super+V on macOS.
- [Codex interaction routing](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/interaction.rs): Ctrl/Alt+V invokes `paste_image_to_temp_png` and attaches its result.
- [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode): Ctrl+V, Cmd+V in iTerm2, and Alt+V on Windows/WSL paste images.
- [Kimi prompt](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/ui/shell/prompt.py): the installed official package binds `c-v` and tries `grab_image_from_clipboard` before text fallback.
