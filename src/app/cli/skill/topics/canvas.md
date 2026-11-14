# Canvas, Spaces and shared work

For agents creating helper nodes, recommend `--near @self` on `node create note`, `terminal`
or `agent`: it uses your current direct Space, or root. Omit it to keep existing placement.
`--near <node selector>` selects another reference; `--root-canvas` overrides membership. Explicit Space/project constraints must match; `--frame` allows width/height only, without x/y. Unsupported Workers refuse.
`node update --frame` grows its Space and ancestors with padding in the same update; Spaces never shrink, other nodes stay fixed and membership stays unchanged.
## Select targets explicitly
Node, space and project selectors accept a full ID, exact case-sensitive name, or a unique ID prefix (6+ characters). Ambiguity exits 6: use a full ID. `@self` uses your authenticated terminal
identity, not your working directory. Inside OpenCove, `node create` and `node list` read your
current container: your Space, or the root canvas when you are outside every Space. There, `node
list` lists the whole project; use `node list --root-canvas` for only root nodes. Explicit
`--project` selects project scope for lists; creation also needs a Space target or `--root-canvas`.
Other commands keep their existing Space defaults. Names/prefixes use your project unless
overridden. Terminal nodes can report observed agents; agent windows and terminals with registered agent run state can receive prompts.
Resolve targets from the agent list before prompting.

```sh
opencove node list -o table
opencove agent list --space @self -o table
opencove agent get --node "Reviewer" --pretty
```

`node list` and `agent list` return at most 50 rows by default; JSON then has `truncated: true`
and `total`, and stderr says how many were omitted. Use `--full` or `--limit <n>` for more.
Create commands accept `-q` to print only the new id (worktree create prints its path), for `$(…)`.
A standalone `session run-agent` has a session grant but no canvas node: `@self` node selectors
fail there. Pass `--node` and `--space` explicitly for non-runtime work, such as creating notes.
Only the user can start standalone sessions. Their grants cannot create agents or terminals; ask
the user to start an agent on the canvas for runtime delegation.

Grant-created agents and terminals share six live or starting descendant slots per creation tree.
The user root is depth 1; runtime delegation stops at depth 3. A slot frees when a session exits
or is stopped, not when a turn finishes or a node disappears. User, task Run and recovery launches
remain available. Creating a runtime across Workers requires the user to start it there.
If OpenCove cannot verify a historical tree after restart, ask the user to check its runtimes
and start a new canvas agent for further delegation.

Agent creation accepts `--full-access true|false` for this agent and its restarts. Omit it to
follow Settings; this never changes Settings. The value cannot be changed with `node update`.

To put a node on the canvas outside any Space: `opencove node create note --root-canvas --text …`.
Outside OpenCove, add `--project <id>`. Placement searches next to you when run inside OpenCove, or
from the origin if your node belongs to another project. Use `--focus` to reveal it.

`opencove space create --name "Review"` creates a top-level Space in your terminal’s current
project; outside OpenCove, add `--project <selector>`. Top-level --directory must be an existing
absolute local directory within the default mount (symlinks cannot escape); children inherit the
parent directory. --frame and --move require --in; output includes the applied rect
({x,y,width,height} in canvas coordinates) and movedNodeIds. `opencove space create --name "Review
notes" --in @self --move "Brief"` creates a child and moves direct members of the parent; repeat
--move. Without --frame, the server encloses moved nodes or centers a 420×300 boundary in the
parent, then fits it inside while keeping room for the moved nodes.
A node created in a full Space is placed right of, then below, its members; the Space and its
ancestors grow to contain it. `space get` and `space list` return the current geometry as `rect`;
`boundary` describes access scope, not geometry. `opencove project add
--path /workspace/app [--name "App"]` requires a human decision: agents cannot add projects. Ask the
user to add the project in OpenCove; do not retry the refusal.

Rename with `opencove space update --space @self --name "Review"`. Adjust its boundary with
`opencove space update --space space-123 --frame '{"x":100,"width":1200}'`.
All frame fields change only the boundary: member nodes and child Spaces stay where they are.
The requested frame expands to enclose them with padding (24 around direct nodes using their
displayed sizes, 12 around child Spaces); ancestors grow as needed. Requested x/y may be adjusted.
Frame updates return appliedFrame/frameAdjusted and print a notice when adjusted. movedNodeIds is
always empty. To move a Space together with its contents, drag it in OpenCove.
Names are trimmed and cannot be blank. Directory and worktree bindings stay unchanged.

## Give a delegated agent its own worktree

When delegation is authorized, create a Space, bind a new worktree to it, then start the agent there.
The project must be a Git repository with an initial commit. Start with a Space whose directory
is the project's repository root. For a child Space, choose a parent rooted there: children inherit
its directory, and worktree creation refuses a Space already bound to another directory.

```sh
opencove space create --name "Review work"
opencove worktree create --space space-123 --name review-work
opencove node create agent --space space-123 --title "Reviewer" --prompt "Review the implementation" --wait --read --timeout 2m
```

Add `--task <nodeId>` to link the new agent to an existing task in that same Space and move it
to `doing`. The task must have no existing linked agent; a link to a deleted agent may be replaced.
Use `--prompt` or `--prompt-file` for the assignment; linking does not copy the task requirement.
The Worker validates before launch and commits both sides together after launch succeeds.
Omitting `--task` leaves tasks unchanged. On the root canvas, both nodes must be outside Spaces.

For one-shot delegation, --wait --read returns the initial exact reply; check outcome and reply.
Stderr first prints `Created agent node <nodeId> (session <sessionId>).`, then a
`Waiting for turn <turnId> of node <nodeId>...` progress line with an interruption-only continuation.
The agent remains created on timeout, attention or read failure. No observed first turn can mean
unavailable lifecycle telemetry, even if the agent is running or has finished; inspect the existing
session without recreating the node or resending the prompt. Use the known node/session/turn IDs
and continuation commands. To keep working meanwhile, omit
--wait and follow the split get → exact wait → exact read loop in `opencove skill coordinate`.

Replace space-123 with the first command's returned id before continuing. To create a child instead,
use `opencove space create --name "Review work" --in <parent>` for the first step. For worktree creation,
--name is optional; omit it to derive the branch name from the Space name. Worktree creation updates
the Space's directory and name; keep using its ID when launching the agent.

A non-Git project fails with exit 1 and `worktree.not_a_git_repo`: "This directory is not a Git
repository." A repository without commits fails with `worktree.repo_has_no_commits`: create an
initial commit before using worktrees. Only launch the agent after worktree creation succeeds.

## Notes and tasks are a shared blackboard
Read existing notes/tasks before changing them. Keep task ownership visible. Claim a task by setting
status `doing` and putting your actual node ID from `whoami` in a tag or requirement note. This is a
coordination convention, not an atomic lock: re-read and negotiate any conflicting claim. `--tag`
replaces the provided tag list, so preserve existing tags or use a requirement note. Finish with
`ai_done`; reserve `done` for human acceptance.

```sh
opencove node list --kind note
opencove node list --kind task
opencove node get --node task-123
opencove node create note --title "Progress" --text "Review started"
opencove node update note --node note-123 --text-file ./progress.txt
opencove node create task --title "Review" --requirement "Review the implementation"
opencove node update task --node task-123 --status doing --requirement "Original requirement; claimed by node-123"
opencove node get --node task-123
opencove node update task --node task-123 --status ai_done
```

Long text accepts `--text-file` or `--requirement-file` and `-` for stdin. Use either inline or file
input. Values after text options are literal, even with leading dashes (`--text "-v"`, `--title
"--draft"`). Preserve others' findings and claims. With `--frame`, create/update results include
`appliedFrame` and `frameAdjusted`; adjustments print a notice. Notes are limited to 220–360 wide
and 140–260 high. `fs write` returns `{uri, bytes}` after success; bytes counts UTF-8 content.

## Names and lifecycle

A nonblank agent/terminal title pins its name; omit it to keep automatic titles. Rename with node
update agent or node update terminal. Only stop nodes you own or were explicitly asked to stop.
Stopping an agent hosted in a terminal stops the entire terminal session, including its shell.

```sh
opencove node create agent --title "Reviewer" --prompt "Review the implementation"
opencove node update agent --node "Reviewer" --title "Lead"
opencove node update terminal --node terminal-123 --title "Build"
opencove agent stop --node "Lead"
```

Stop keeps the canvas node; an already exited session returns not_running, exit 0. An exited
observed terminal agent is also a no-op: its surviving shell is kept running. Plain terminals and
remote agent-stop targets are refused; inspect before choosing another action.

## Creation lineage and parent selectors

`@parent` selects the node that created your node through an OpenCove session grant.
The Worker resolves it from your authenticated identity. It can be a terminal or another node
kind; each command still checks whether the target supports that action. A root has no parent,
and a deleted parent cannot be addressed. A node literally named `@parent` must be selected by ID.
`@self` keeps its injected identity and `whoami` fallback; Space selection keeps its existing behavior.

Node get/list/create, agent get/list and context node summaries expose creation lineage:

- `spawnedBy`: the creator node ID, or `null` for a root or unavailable lineage.
- `lineageDepth`: A node started by the user has `lineageDepth` 1; each agent-created generation adds one (1 → 2 → 3). Unavailable lineage has `null` depth.
- `lineageStatus`: `recorded` for recorded creations, `root` without a recorded parent, or `unavailable` when lineage cannot be read. Missing fields mean an older Worker.

Lineage survives renames, moves, parent deletion, renderer saves and restart.

Use `node list --spawned-by @self` or `agent list --spawned-by @self` for direct children across
the project; an explicit `--space` or `--project` narrows results. Filtering precedes output limits.
`@parent` and `--spawned-by` require `features.nodeLineageV1`; older Workers fail with exit 5.

With `--spawned-by`, `--project` filters child results; the creator may belong to another project.
Full IDs, `@self` and `@parent` resolve the creator independently of that filter. Creator names
and prefixes use your session project, or an explicit Space’s project. Without session identity,
the selected project supplies the name lookup context. Use a full ID for a creator outside that context.

`opencove whoami --fields lineageQuota` and `opencove context --fields self.lineageQuota`
show `{depth, maxDepth, liveInTree, maxLiveInTree}` from the same Worker census as spawn admission.
A user-started root has depth 1; liveInTree counts live/starting agent-created runtimes, excluding
that root. Older Workers or unavailable accounting omit the quota. Depth/width refusal details
include up to six occupying nodes (nodeId, title, kind, depth, state), with concrete
`opencove agent stop --node <id>` hints for agent occupants. For terminals, read the current
`node.sessionId` with `opencove node get --node <id> --fields sessionId`, then use
`opencove session kill --session <sessionId>` to stop the entire terminal, including its shell.
Stopping cannot reduce a caller's depth: depth-three callers must ask the user to start a new root.
