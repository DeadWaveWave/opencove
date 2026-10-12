# Claude session identity

Managed Claude agents have an explicit conversation identity. A working directory,
transcript modification time, or a filename found nearby cannot establish which
conversation belongs to a node.

## Ownership and launch

The Claude provider launch planner allocates a fresh UUID for each new managed
agent and passes it to Claude with `--session-id`. The launch result carries the
same ID through local and remote mounts, renderer actions, and control-surface
node creation. The node persists this assigned ID as a verified binding. This
verification establishes ownership; it does not claim that Claude has already
written a transcript or successfully contacted a model.

An explicit resume uses the existing ID with `--resume`. Managed resume without
an ID is rejected; it must never turn into `--continue` and select the latest
conversation in the directory. These rules do not change commands a user types
in an ordinary terminal.

Authenticated SessionStart hooks can publish managed session identity without a
terminal invocation context. Terminal launches continue to use their invocation
registry, generation, and current-invocation checks. The first accepted identity
is fixed for a hook reservation. Launch results also carry the assigned ID, so a
hook arriving before the renderer creates the node cannot lose the binding.

## Discovery and recovery

- Claude discovery without an authoritative ID returns no candidate, even if
  only one JSONL exists. A single candidate still provides no node ownership.
- Same-directory, parent-directory, and equal-mtime files cannot assign an ID.
- Missing or false `resumeSessionIdVerified` is unverified for every provider.
  Legacy Claude records do not become verified merely because they contain an ID.
- Existing explicitly verified bindings retain their exact ID. A missing file,
  failed resume, or conflicting later observation does not switch the node to a
  different conversation. A failed launch follows the existing recovery fallback.
- Blank unbound agents may start a fresh conversation; the newly assigned Claude
  ID must survive that recovery result and the next persistence round trip.

The policy deliberately trades automatic discovery of old unbound conversations
for avoiding silent recovery into somebody else's conversation. It does not
automatically repair IDs that an older version already guessed and persisted as
verified: the stored boolean does not record whether that identity came from a
hook, explicit launch, or heuristic. Clearing every such record would also erase
correct bindings. Historical duplicate verified IDs require explicit inspection;
new UUID allocation is not a cross-node lock for previously saved sessions.

## References and regression layers

Claude documents [explicit session IDs and resume flags](https://code.claude.com/docs/en/cli-reference)
and the session ID in [SessionStart hook input](https://code.claude.com/docs/en/hooks#sessionstart).
OpenCove uses the launch assignment and authenticated event rather than inferring
ownership from the transcript directory. Exact-ID recovery can remain valid
after a directory or worktree changes.

Regressions cover real isolated JSONL fixtures, command and concurrent launch
plans, hook ownership, persistence normalization, and recovery preparation.
Electron tests use an artificial provider process to exercise persisted bindings
across a complete owned Worker restart. They do not establish real Claude model
behavior; authenticated Claude cold-restart verification is a separate layer.
