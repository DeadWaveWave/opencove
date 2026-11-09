/** Embedded in the standalone relay: no app imports, credentials or dynamic context. */
export const agentHookReplyScript = String.raw`
function validEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      !!url.port && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/hooks/' + provider;
  } catch { return false; }
}
async function readContextReply(response, signal) {
  if (response.status !== 200 || response.redirected ||
      !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once:true});
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (signal.aborted) return null;
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) return null;
      chunks.push(Buffer.from(value));
    }
    const reply = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
    if (!reply || reply.v !== 1 || typeof reply.context !== 'string' ||
        !reply.context.isWellFormed() || !reply.context.trim() || Buffer.byteLength(reply.context, 'utf8') > 2048) return null;
    const output = JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:reply.context}}) + '\n';
    return Buffer.byteLength(output, 'utf8') <= 16 * 1024 ? output : null;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function postObservation(endpoint, token, body, sessionStart) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, sessionStart ? 250 : 1500); }),
      (async () => {
        const response = await fetch(endpoint, {
          method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json', 'x-opencove-hook-token': token, 'x-opencove-hook-emitted-at': String(emittedAtMs) },
          body, signal: controller.signal,
        });
        if (sessionStart) return await readContextReply(response, controller.signal);
        await response.body?.cancel();
        return null;
      })(),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}
async function writeContext(output) {
  await new Promise(resolve => {
    // Keep this listener installed until exit, including errors after the write callback.
    process.stdout.on('error', () => resolve());
    process.stdout.write(output, () => resolve());
  });
}
`
