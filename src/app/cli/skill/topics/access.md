# Access, launches and resident guidance

A session grant is a guardrail for agents running as the same OS user, not an OS sandbox. Project
isolation is not yet enforced. Use only the user's authorization, even where an API operation is
allowed. Never print tokens or seek another agent's credentials.

## Discover current access

```sh
opencove whoami
opencove api ops --prefix node --fields id,cliCommand,scope,access --limit 10
opencove api schema session.launchAgent
opencove api schema agent.prompt
```

Inside OpenCove, `api ops` and `api schema` report the Worker's access policy and policyVersion.
Access is allowed, denied (with a reason), constrained, or unknown. Schema fields alone do not
authorize their use. Constrained launch schemas also list rejectedFields and their reasons. Offline
or with an older Worker, access is unknown. `scope` is the read/interact/admin ceiling; it does not
replace the grant policy.

## What grants allow

Listed canvas, filesystem, worktree and session operations are available, subject to operation
preconditions and resource permissions. Examples include reading nodes, creating notes/tasks/Spaces,
updating titles, focusing the canvas, managing worktrees, reading/writing approved files, reading
agent replies and stopping sessions. Agent launches and prompts have additional constraints. Unknown
operation IDs fail closed.

## What requires the user

Ask the user in OpenCove for endpoint/mount administration, project addition/root approval, private
settings, the default permission policy, Worker administration, and plugin distribution or execution. Grants
cannot run plugin commands, invoke plugin code, or open plugin views/windows. They can read listed
plugin metadata; this does not authorize running it.

Raw `session.writeNode` is refused: send authorized task messages with `agent prompt`. Only the user
answers permission prompts, questions and plan dialogs in OpenCove. Observation, recovery and saved
terminal history are managed by OpenCove. A refusal is not permission to try another route.
Authentication and grant-policy refusals exit 4.

## Constrained agent launches

From a canvas-bound session, use `opencove node create agent` or `opencove node create terminal`.
Agent creation may include `--task <nodeId>` (`node.create` `data.taskNodeId`) to link an existing
task in the same Space and move it to `doing`; this uses the same session-grant authority.
These are the only grant routes that start runtimes. The caller must still be the canvas node’s
current local session. Raw launch operations, including `session run-agent`, cannot be used by grants.
A user can still start a standalone session with bearer authority. Its grant keeps reads, notes and
other non-runtime abilities; runtime delegation requires the user to start an agent on the canvas.

Agent and terminal descendants share a limit of six live or starting runtimes per creation tree.
The user root is depth 1; children are depth 2 and grandchildren depth 3. A fourth runtime generation
is refused. Finishing a turn does not free capacity: a session in the tree must exit or be stopped.
Moving nodes or deleting ancestors does not reset ancestry. User launches, task Run and recovery are
exempt. Recovered descendants count toward subsequent grant requests. Grant runtime creation must
stay on the same Worker; ask the user to start an agent on the target Worker for remote work.

Agent launches use the user’s saved permissions by default. Explicit `--full-access true|false`
(`agentFullAccess`) applies to that one agent, in either direction, and is remembered on its node
for relaunch, resume and recovery. It never changes Settings. Nodes without an explicit value
follow the current Settings → Agent → Providers → Permissions → Full Access Mode value.
The saved environment and executable still apply: explicit `env`, `executablePathOverride`,
`resumeSessionId`, `codexReuseRunningAppServer`, `mode` and unknown fields remain refused,
including false/null values.

<!-- initial-prompt-rules:start -->
Agent-terminal prompt rules:
- Launches: describe a task in a sentence; single tokens and provider command names are refused.
- Provider controls: no leading /; Claude also refuses ! # &; Codex, OpenCode, Pi and Gemini also refuse !.
- Exit aliases: no exit, quit, :q, :q!, :wq or :wq!.
- File references: no @ anywhere. Read approved content with opencove fs read --uri file:///workspace/README.md --fields content (replace the absolute URI), then paste the content.
- Codex skills: no $name or linked skill mentions; paste the instructions.
- Leading dashes: Claude Code and Pi launches refuse prompts starting with -.
- Null characters: remove NUL from the prompt.
<!-- initial-prompt-rules:end -->

Provider-command grant refusals use field_denied and exit 4 before input or a delivery record.
Launch permission does not establish prompt eligibility; see `opencove skill coordinate`.

## Resident canvas guidance

Supported local Claude Code and Codex agents can receive fixed canvas guidance at SessionStart. It
introduces identity, sharing notes, `ai_done`, and asking before delegation. Configure Suggest
(default) or Off in Settings → Agent → Tell agents about OpenCove. The executing Worker's setting
applies to the next SessionStart; Off cannot retract text already delivered. Missing/invalid
settings use Suggest.

Only launches with local canvas identity qualify, including supported terminal-started agents.
Cwd-only launches, delegated remote identities, Codex daemon reuse, notify-only integration and
Windows file-only observation receive no introduction. Other providers are unsupported. Timeout,
unavailable Workers and invalid replies skip guidance without blocking the agent. Guidance never
includes canvas titles or other agent content.
