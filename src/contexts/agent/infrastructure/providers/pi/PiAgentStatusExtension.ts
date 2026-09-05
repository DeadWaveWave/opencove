/** Standalone launch artifact. Only Node built-ins: no dependency on the host application's
 * module graph or a particular Pi package name. The contract suite executes this exact source.
 */
export const piAgentStatusExtensionSource = String.raw`
import { request } from 'node:http';
import { stat } from 'node:fs/promises';

export default function (pi) {
  const token = process.env.OPENCOVE_PI_HOOK_TOKEN;
  const endpoint = process.env.OPENCOVE_PI_HOOK_ENDPOINT;
  const parentPid = process.env.OPENCOVE_PI_STATUS_OWNER_PID;
  if (!token || !endpoint || (parentPid && parentPid !== String(process.pid))) return;
  let url;
  try { url = new URL(endpoint); } catch { return; }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/hooks/pi' || url.username || url.password || url.search || url.hash) return;

  const key = Symbol.for('opencove.pi.status');
  let shared;
  let active = false;
  let stopped = false;
  let pending = null;
  let sending = false;
  let currentRequest = null;
  let deadline = null;
  let heartbeat = null;
  let idleCheck = null;
  let context = null;
  let waiting = false;
  let state = 'standby';

  function stop() {
    if (stopped) return;
    stopped = true;
    active = false;
    pending = null;
    context = null;
    clearInterval(heartbeat);
    clearTimeout(idleCheck);
    clearTimeout(deadline);
    currentRequest?.destroy();
    currentRequest = null;
  }

  // Includes the filesystem probe in the single-flight window. A slow filesystem cannot spawn
  // unbounded probes, and Pi handlers never await either filesystem or network work.
  async function drain() {
    if (!active || stopped || sending || !pending) return;
    sending = true;
    const snapshot = pending;
    pending = null;
    if (snapshot.sessionFile) {
      try {
        const info = await stat(snapshot.sessionFile);
        if (info.isFile() && info.size > 0) snapshot.persistence = 'resumable';
      } catch { /* Allocated is not a destructive identity observation. */ }
    }
    if (!active || stopped) { sending = false; return; }
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      deadline = null;
      currentRequest = null;
      sending = false;
      void drain();
    }
    try {
      const req = request(url, {
        method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', 'x-opencove-hook-token': token },
      }, response => {
        response.on('end', finish);
        response.on('error', finish);
        response.resume();
      });
      currentRequest = req;
      req.on('error', finish);
      deadline = setTimeout(() => { req.destroy(); finish(); }, 1000);
      deadline.unref?.();
      req.end(JSON.stringify(snapshot));
    } catch { finish(); }
  }

  function publish(ctx) {
    if (!active || stopped || globalThis[key] !== shared) return;
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
      // Capture plain data before any await; contexts become invalid after replacement.
      if (shared.sessionId !== sessionId || shared.sessionFile !== sessionFile) {
        shared.conversationRevision += 1;
        shared.sessionId = sessionId;
        shared.sessionFile = sessionFile;
      }
      pending = {
        version: 1, pid: process.pid, sequence: ++shared.sequence,
        conversationRevision: shared.conversationRevision, sessionId, sessionFile,
        persistence: sessionFile ? 'allocated' : 'ephemeral', state,
      };
      void drain();
    } catch { /* Observation failure must not interfere with Pi. */ }
  }

  function idle(ctx) {
    try { return ctx.isIdle() === true && ctx.hasPendingMessages?.() !== true; }
    catch { return false; }
  }

  function setState(next, ctx) {
    if (!active || stopped) return;
    state = waiting ? 'waiting' : next;
    context = ctx;
    clearInterval(heartbeat);
    heartbeat = null;
    if (state === 'working') {
      heartbeat = setInterval(() => publish(context), 60_000);
      heartbeat.unref?.();
    }
    publish(ctx);
  }

  pi.on('session_start', (_event, ctx) => {
    if (stopped) return;
    const previous = globalThis[key];
    if (previous?.token === token && previous.pid === process.pid) {
      previous.stop();
      shared = { ...previous, stop };
    } else {
      shared = { token, pid: process.pid, sequence: 0, conversationRevision: 0,
        sessionId: null, sessionFile: null, stop };
    }
    globalThis[key] = shared;
    process.env.OPENCOVE_PI_STATUS_OWNER_PID = String(process.pid);
    active = true;
    setState(idle(ctx) ? 'standby' : 'working', ctx);
  });
  pi.on('before_agent_start', (_event, ctx) => setState('working', ctx));
  pi.on('agent_start', (_event, ctx) => {
    clearTimeout(idleCheck);
    setState('working', ctx);
  });
  pi.on('ui_prompt_start', (_event, ctx) => { waiting = true; setState('waiting', ctx); });
  pi.on('ui_prompt_end', (_event, ctx) => {
    waiting = false;
    setState(idle(ctx) ? 'standby' : 'working', ctx);
  });
  pi.on('agent_settled', (_event, ctx) => {
    clearTimeout(idleCheck);
    if (idle(ctx)) setState('standby', ctx);
  });
  // Compatibility for releases without agent_settled: defer beyond the low-level end callback
  // and require affirmative idle/pending evidence. Shutdown itself never emits completion.
  pi.on('agent_end', (_event, ctx) => {
    if (!active || stopped) return;
    clearTimeout(idleCheck);
    idleCheck = setTimeout(() => { if (idle(ctx)) setState('standby', ctx); }, 0);
    idleCheck.unref?.();
  });
  pi.on('session_before_compact', (_event, ctx) => setState('working', ctx));
  for (const event of ['session_compact', 'session_compact_failed']) {
    pi.on(event, (event, ctx) => {
      if (!event.willRetry && idle(ctx)) setState('standby', ctx);
    });
  }
  pi.on('session_shutdown', stop);
}
`
