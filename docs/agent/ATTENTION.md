# Agent attention

When an Agent ends a turn and waits for you, OpenCove tells you once. Three channels can carry it.
Each has its own switch in Settings › Notifications and a tile in the Control Center:

- **In-app card**: the card at the top right. Clicking it focuses the Agent.
- **System notification**: the operating system's banner, sent only while OpenCove is not in front.
- **Sound**: one synthesised alert (`bit` pixel default, `tide`, `pebble`), at its own volume.

## Routing

| OpenCove is | In-app card | System notification         | Sound            |
| ----------- | ----------- | --------------------------- | ---------------- |
| In front    | shown if on | dropped by main, even if on | plays once if on |
| Behind      | shown if on | sent if on, always silent   | plays once if on |

- The app plays the one sound itself, in front or behind; the system notification never sounds, so
  an alert never chimes twice.
- Clicking a system notification focuses that Agent through the same jump as clicking its card.

## Owners

| Decision                      | Owner                                                           |
| ----------------------------- | --------------------------------------------------------------- |
| Did an Agent start waiting?   | `useAgentStandbyNotificationWatcher` (renderer, from PTY state) |
| Which channels fire, and when | `createAgentAttentionRouter` (`agentAttentionRouter.ts`)        |
| Is OpenCove in front?         | Main (`systemNotifications.ts`): any focused app window         |
| What the sound is             | `notificationSound.ts`: Web Audio, no files                     |

The renderer cannot trust its own focus signals for the foreground gate, so main decides it at the
moment it would show the notification.

## Invariants

- **One alert per wait.** An Agent already announced is not announced again until it has worked for
  at least 800 ms (`AGENT_ATTENTION_REWORK_DEBOUNCE_MS`). Shorter work is jitter: the card stays and
  nothing sounds.
- **One sound per burst.** Agents that start waiting within 1.5 s (`AGENT_ATTENTION_COALESCE_MS`)
  share one sound and one system notification. The first notification names its Agent; when the
  window closes with more than one Agent still waiting, it is replaced by one that counts them
  ("3 Agents need you"). Cards stay one per Agent.
- **No alert at startup.** A wait whose `observedAtMs` predates the watcher, or an Agent still being
  restored, is a baseline, not news.
- **Switches are read when the alert fires**, not when the router was created.

## Tests

- Decision table, coalescing, debounce: `agentAttentionRouter.spec.ts`.
- Startup baseline: `tests/unit/app/agentStandbyTerminalNotification.spec.ts`.
- Foreground gate, silent delivery, replacement and click: `tests/contract/ipc/systemNotificationIpc.spec.ts`.
- End to end, in front and behind: `tests/e2e/workspace-canvas.agent-attention-routing.spec.ts`.
  Main records notifications in `globalThis.__opencoveSystemNotificationTestState` (a test can
  pretend focus and click one); the renderer records sounds in `window.__opencoveNotificationSoundTestLog`
  instead of playing them.
