# Claim tasks and share results

Use an existing agent to claim a task, record the result, and release it for review:

```sh
opencove task claim --task "Review"
opencove note append --node "Progress" --text "Review complete; boundary tests passed"
opencove task release --task "Review" --status ai_done
```

Inside an agent session, claim defaults to your authenticated agent. A user must
supply `--agent <selector>`. Session grants may select their own agent or any direct or transitive descendant in the Worker’s recorded spawn lineage; siblings and unrelated agents are refused. Task
and agent must be in the same project and Space, including the root canvas.
One agent can hold one task; release its current task before claiming another.
A stale reciprocal `agent.taskId` alone does not block a claim.

A task stays held while its linked agent node exists, even if the session has
exited or is waiting. A missing or non-agent link target can be replaced. Claiming
a task you already hold succeeds without changing `lastRunAt`; repairs to status
or the reciprocal link update `updatedAt`. Another holder produces
`task.already_claimed` (exit 1), with `details.taskNodeId` and
`details.holder: {nodeId, title}`. Choose another task or ask for a release. There
is no force claim.

Release is available to the current holder, any caller that started the holder (directly or transitively), or a user with mutation access. It
clears the task link and the former agent’s reciprocal link only when that link
still names the task. Release defaults to `todo`; `ai_done` means ready for
review, and `done` means finished. `doing` is not a release status. Release works
after a move to another Space in the same project. It preserves history and
`lastRunAt` and does not stop, delete or archive the agent. A grant outside the holder’s recorded ancestry
receives exit 4 with `reason: not_current_holder` and current holder details.

## Append to a shared note

```sh
opencove note append --node "Progress" --text "Checked error handling"
opencove note append --node "Progress" --text-file ./result.txt
printf '%s' 'Ready for review' | opencove note append --node "Progress" --text-file -
```

Choose exactly one text source. Text must be nonempty; whitespace is preserved.
An empty note takes the text directly. Otherwise, two newline characters separate
the existing body from the new text. Limits are 64 KiB of UTF-8 text per append
and 1 MiB for the resulting note, including the separator. Overflow is refused
without truncation. Append supports notes, not task requirements. Session grants
can append to notes in their project even without an agent node identity.

Claim/release return `{revision, node, changed}`; `node` is the task detail.
Append returns `{revision, nodeId, appendedBytes, totalBytes}`; `appendedBytes`
includes the separator. Output is newline-terminated JSON. `--pretty` and
`--fields` work on all three commands. Claim/release accept node fields such as
`id,data.status`, plus envelope fields `revision,changed`. Append accepts its four
result fields. Failures leave stdout empty.

## Concurrency and recovery

These commands require a supporting Worker. If unavailable, exit 5 asks you to
restart or update OpenCove; commands never emulate the mutation using replacement
updates. Invalid input exits 2, authorization exits 4, ambiguous selectors exit 6,
and missing targets or persistence failures exit 1. Existing connection, timeout
and interruption codes still apply.

Competing Worker claims have one winning holder. Task and reciprocal changes
commit together. Concurrent successful appends retain all entries in commit order.
Each operation retries at most three definite revision conflicts, recomputing
from current state. Unrelated state changes may exhaust this budget.

These guarantees apply to these Worker mutations. A live renderer applies canonical updates before acknowledging them. A genuinely stale tab
can still overwrite task fields; an ordinary note replacement can overwrite appended
text. These commands do not provide a lease or global project isolation for
other APIs. After a timeout, disconnect or uncertain write outcome, inspect the
task or note before deciding what to do. There is no automatic network replay or
deduplication: repeating an append can duplicate its text.
