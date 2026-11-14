# Claude continuations and transcript recovery

The executing Worker registry owns these private records. See [Agent run state](./RUN_STATE.md)
for public state, blocking dialogs, turn boundaries and readiness invariants.

## Claude queued continuations

A human message queued while Claude works belongs to the **current OpenCove turn**.
Claude Code 2.1.319 can absorb it at a tool boundary (`queue-operation: remove`),
or dequeue it into another provider turn (`user`, `promptSource: queued`, new
`promptId`) without another start hook. Both paths keep the OpenCove turn ID and
start timestamp. More queued messages during a continuation follow the same rule.

A same-ID `UserPromptSubmit` is submission evidence, never activity evidence: it
cannot clear permission waiting or replace the original identity freshness fence.
It still emits an internal receipt; text comparison does not qualify receipts.
There is no provider queue-item ID in these records. The private registry helper
reconciles hook hints and transcript enqueues FIFO by occurrence, regardless of
text equality; identical repeated messages remain separate. A private content hash
matches a removal to one occurrence, never deduplicates enqueues. Arbitrary tool
hooks do not prove consumption. Without record evidence, repeated same-ID hooks
cannot be distinguished from a delayed duplicate; they conservatively retain a
possible continuation until reconciliation or an unknown outcome.

The existing session-file watcher also sends typed private records, carrying the
resolved provider session, file identity (device/inode plus truncation epoch),
watcher generation and record ordinal. Baseline records, including a partial
baseline record completed later, never create queue state. Generation, incarnation,
provider session and position fences reject stale/replayed evidence. Sidechain
records are excluded. These records never compete as coarse session-file activity
and never enter public DTOs, renderer messages, remote mirrors or receipt rings.

With unresolved queue evidence, Stop retains its reply/outcome as an intermediate
and keeps the turn working, with no completion event, lastEndedTurn or readiness.
A queued user record attaches its provider ID to that turn. Its matching Stop
ends the OpenCove turn once, inserts final history before any callback and publishes
one completion. Retained provider IDs include the earlier provider segments to
prevent replay. Exact turn waits therefore include continuations; exact reads
return the final reply. Default reads select only the latest ended turn, not all
intermediate replies or all replies since an idle wait.

Reconciliation keeps at most 64 unresolved occurrences, with rolling identity
history and one early unmatched Stop. Resolved occurrences evict first under
pressure, so a long sequential continuation does not exhaust the active budget. It waits at most five seconds after a provider Stop. A `remove` accounting
for the final unresolved item ends the turn immediately using the retained Stop;
no timer grants readiness. Dequeue alone reserves an item for a queued user record;
without that record it is ambiguous whether a follow-up ran. An explicit removal
can account for that item too. At the deadline, unavailable evidence, file reset,
unknown queue operations or buffer overflow end the stopped turn as `unknown`,
using the last provider reply with `messageKind: intermediate`. State becomes
unknown/degraded and readiness stays revoked until fresh authoritative evidence.
A unique buffered Stop with exactly one pending item is the sole identity fallback:
it may end the continuation with that Stop's actual outcome/reply, but a timed
fallback still leaves state degraded and grants no readiness. Multiple pending
items or conflicting buffered Stops remain uncertain. A deadline without an
observed provider Stop never fabricates an end. Replacement, exit and disposal
cancel the existing entry scheduler and release private buffers.

Ctrl+Enter, Esc and interrupts are not independently identifiable from these
records; interruptions need not emit Stop. A distinct fresh hook submission uses
P2-E supersession (prior outcome unknown), unless its ID is already a retained
segment. The original OpenCove start's relay timestamp remains the freshness fence
through continuations; transcript timestamps never become relay timestamps.
Missing/equal/older relay times cannot authorize supersession. No PTY keystroke
heuristic changes activity or invents an aborted/completed turn.

### Claude transcript attachment and readiness recovery

Managed and terminal Claude hooks retain `transcript_path` privately. Each hook
credential captures trusted config directories from its resolved launch environment:
an explicit `CLAUDE_CONFIG_DIR` authorizes only that config, otherwise defaults
come from `ClaudeProjectPaths` using captured launch `HOME`/`USERPROFILE`/home-drive
values, with platform home fallbacks only when that environment lacks a home. The
supplied launch environment is complete;
removing a Worker config variable does not silently inherit its old authority.
Desktop planning and spawning use the same resolved shell environment snapshot.

Before attachment and every read, the target must be a regular nonsymlink file
named `<session_id>.jsonl`, canonically contained by an authorized `projects`
directory. Trusted roots are canonicalized once per observer. Equivalent canonical
and lexical spellings (including `/var` aliases, symlinked config directories and
Windows extended-length prefixes) share authority. Outside paths, sibling prefixes, escaping parent symlinks, redirected
projects roots, leaf symlinks and special files are unavailable observations with
no watch/read of the rejected file. Metadata checks do not read file content.
Secure opens verify descriptor type and identity against revalidated paths, close
rejected handles, and use no-follow/nonblocking flags on POSIX. Windows uses the
portable metadata/descriptor checks; native Windows race behavior is not attested
by macOS unit tests. These checks are defense in depth, not a filesystem sandbox:
same-user writes that swap parent directories between pathname operations are
outside the threat model. Node lacks descriptor-relative `openat` traversal, so
pathname/descriptor revalidation cannot make that traversal atomic.

The registry owns polling demand: pending reconciliation/recovery or a nonempty
queue keeps validated polling at 250 ms. Hooks refresh immediately and open a
bounded two-second observation window. Idle sessions outside that window perform
zero periodic filesystem calls. Four unchanged active polls per second use eight
`lstat`, eight `realpath`, four opens, eight descriptor stats and four closes
(**32 filesystem calls/second/session**); canonical root setup and growing-file
reads add one-time or content-dependent calls. It deliberately avoids pathname-based native watches, which cannot bind
a validated descriptor across an ABA path replacement. The general file watcher
still uses `fs.watch`: asynchronous errors close/null its watcher and publish guarded
unavailability while retaining its poll. Reads drain in one iterative async loop;
notifications during a read are coalesced, with at most one read in flight.
This works even when general discovery/state watchers are disabled.

Every private record/error callback checks the validity captured at attachment
and carries its originating incarnation; ingress never assigns the current
incarnation to an old record. Accepted `SessionEnd` detaches and retires the observer
**generation**, not the provider identity or invocation. State hooks remain
invocation-authenticated after conversation end; history correlation still rejects
conflicting ends. The [Claude hooks reference](https://code.claude.com/docs/en/hooks#sessionstart)
distinguishes `startup`, `resume`, `clear`, `compact` and `fork` sources. Those values
travel only in the private envelope as `sessionStartSource`; malformed sources are
discarded. OpenCove treats an ongoing same-session refresh (including compaction,
resume, and repeated startup without an end) as an observer refresh, preserving
its active turn, permission wait, continuation and recovery ticket. Its eventual
Stop completes the same turn and retains that Stop's reply. Fresh relay-ordered
conversation changes replace the observer generation: a different provider ID,
`clear` even if the ID is reused, or startup/resume after an accepted end. A late
same-ID compaction after an end cannot revive its retired watcher. Old callbacks and older events
cannot reattach its watcher. The oldest retired generations are evicted after 64;
observation is never disabled by retirement capacity. Missing relay times cannot
prove a fresh resume after an end, though state hooks continue to publish. Once
a relay-ordered generation exists, un-timestamped events cannot select or replace
its observer.

An accepted generation transition retires its predecessor's continuation, recovery
ticket and degraded latch. An active predecessor ends with unknown outcome;
readiness stays unknown until the new generation supplies a valid submission and
completion. Old transcript generations cannot restore the predecessor's readiness.

A degraded end retains its recovery reason and unresolved multiplicity, including
unseen enqueue hints, queued identities and bounded retained Stops (64 per collection). These are rolling windows, not
lifetime quotas: baseline/older user identities and already paired Stops evict
first. The current EOF candidate stays retained; a Stop awaiting its user record
is never evicted to admit history. The latest correlated end is also retained
separately when all Stop slots await users. More than 64 simultaneously unmatched
Stops remains a conservative capacity limit; eviction never supplies completion
evidence. Paired status survives eviction of its older user ID.
A late queued user can correlate a follow-up Stop arriving before or after that
record, even after timeout. It never grants readiness by itself. Recovery commits
only at the whole read's fully reconciled EOF: known queue operations balance to
empty, the latest identified user matches the actual correlated Stop, and its
assistant is terminal (`end_turn`), with no later user/assistant activity. A later
enqueue in the same batch prevents readiness, even after a unique early-Stop
fallback. Baseline replay has the same proof requirement and never creates live
queue state. Unsupported/unidentified main-chain users clear checkpoint identity
and finality. No recovery is published between records; newer correlated Stops
received during a read also wait for EOF.

Fresh EOF stats revalidate the complete folded prefix; incomplete records, unread
appends, unknown operations, rewrites and truncation cannot supply a stale proof.
No deadline or elapsed silence grants readiness. While latched, equal/older or
missing relay-time Stop replays are rejected before replacing source evidence.
Only genuinely newer correlated lifecycle evidence, or validated transcript
completion, restores readiness. Recovery updates the selected hook observation and
`lastTurnEnd` atomically, without revising history/outcome or emitting a second
completion. Relay timestamps are never synthesized from transcript/arrival times.

Set `OPENCOVE_DEBUG_AGENT_CONTINUATION=1` on the Worker/main process for content-free
stderr diagnostics: decisions, pending counts, generations, positions and elapsed
milliseconds, with eight-character sanitized ID prefixes. No message text, token,
envelope, filesystem path or tool input is logged. The switch is off by default.


Live prompt readiness after a new-ID Claude `/clear` belongs to the executing Worker's
volatile conversation owner, independently of the saved restart target. Clear creates no
successor turn; the first accepted submission captures its own provider session identity.
Late predecessor hooks and transcript callbacks cannot update the successor generation.
See [prompt delivery](CLAUDE_CLEAR_PROMPT.md) for the
relay-order assumption, quarantine and observed-readiness limits. B4b commitment grants
no readiness and rewrites no turn identity. This adds no public generation field or
persistence schema; startup/resume/compact readiness is unchanged.
