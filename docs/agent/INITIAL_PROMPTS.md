# Initial prompts

Describe the task when starting an agent. Accepted prompts keep their text, with surrounding whitespace removed. Line breaks, quotes and Unicode inside the prompt are preserved. Resuming a conversation does not send the initial prompt again.

Prompts containing a null character are refused for every provider before launch. Remove the null character and try again; your text remains editable. This also applies to prompts sent from agent terminals.

Some provider inputs are commands rather than conversation text. OpenCove refuses these before launch:

| Provider | Refused launch input |
| --- | --- |
| Claude Code | Exact root commands and aliases, including hidden commands; prompts starting with `-` |
| Pi | `install`, `remove`, `uninstall`, `update`, `list`, `config`; prompts starting with `-` or `@` |

If a launch is refused, rephrase the task, for example “Explain how to update this project.” To run a provider control deliberately, open a blank session and enter it there. Task requirements and role input remain editable. A refused task reuse or relaunch keeps the previous session alive.

Codex uses an argument delimiter; OpenCode, Gemini and Kimi use their typed prompt options. Kimi’s existing Full Access requirement still applies. UI-authored prompts can invoke provider composer controls, such as `/help` or `exit`, after passing launch admission.

## Prompts from agent terminals

<!-- initial-prompt-rules:start -->
Agent-terminal prompt rules:
- Launches: describe a task in a sentence; single ASCII words and provider command names are refused; unspaced Chinese/Japanese/Korean text is fine.
- Provider controls: no leading /; Claude also refuses ! # &; Codex, OpenCode, Pi and Gemini also refuse !.
- Exit aliases: no exit, quit, :q, :q!, :wq or :wq!.
- File references: no @ anywhere. Read approved content with opencove fs read --uri file:///workspace/README.md --fields content (replace the absolute URI), then paste the content.
- Codex skills: no $name or linked skill mentions; paste the instructions.
- Leading dashes: Claude Code and Pi launches refuse prompts starting with -.
- Null characters: remove NUL from the prompt.
<!-- initial-prompt-rules:end -->

Refusals happen before launch or terminal input.

These restrictions use the authenticated session grant. A trusted UI or CLI caller keeps its existing authority. They do not create a filesystem sandbox or prove literal delivery into every live composer state. Existing drafts, Claude bash mode and user-installed Pi input handlers remain outside this launch guarantee; inspect the target with `agent read --screen` before sending a message. Remote spawning from grants remains unavailable.

## Compatibility

Parser evidence is pinned to Codex 0.166.0 / Clap 4.5.58, Claude Code 2.1.322, Pi 0.80.7, OpenCode 1.3.13, Gemini 0.32.1 and Kimi 1.16.0. Provider upgrades, wrappers and user extensions can change interpretation and require fresh evidence. A remote destination must contain this implementation; a Home-only check cannot establish destination safety.

Windows launches preserve prompt boundaries through PowerShell and ConPTY. Standard npm Node shims are verified and launched directly through Node; custom wrappers are refused when their argument behavior is unverified. Choose a native executable or a standard npm installation if the wrapper is refused. WSL launches use direct execution rather than interpreting prompts as shell commands.

## Shared launch-policy inputs

The CLI and Worker use the same pure prompt-policy functions in `src/shared/utils/`.
The agent domain entry point re-exports the provider policy. Authentication remains at the
Control Surface; only callers with a session grant receive the additional grant text checks.
When batch launch omits a selectable provider, its default is private Settings state. The CLI
checks the possible selectable providers conservatively; choose `--provider` to validate a
provider-specific literal without reading or overriding private settings.

The pinned Claude root registry can be regenerated from its checked-in source audit without
reading an installed provider or user configuration:

```sh
node scripts/generate-claude-command-registry.mjs --from-audit
node scripts/generate-claude-command-registry.mjs --from-audit --check
```

To update the pinned source audit, the original executable-path mode still verifies Claude Code
2.1.322 and records its source hash. Both modes generate the shared table and the domain forwarding
module; never edit either generated file by hand.
