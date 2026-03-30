function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderWorkerWebShellPage(params: { host: string }): string {
  const host = escapeHtml(params.host)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCove Worker Shell</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
      body { margin: 20px; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
      label { display: inline-flex; gap: 8px; align-items: center; }
      input, select, textarea { font: inherit; padding: 6px 8px; }
      textarea { width: 100%; min-height: 160px; }
      button { font: inherit; padding: 6px 10px; cursor: pointer; }
      pre { padding: 12px; border: 1px solid rgba(127,127,127,.4); overflow: auto; }
      .muted { opacity: 0.75; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 10px; max-width: 960px; }
    </style>
  </head>
  <body>
    <h1>OpenCove Worker Shell</h1>
    <div class="grid">
      <div class="row muted">
        <div>POST <code>/invoke</code></div>
        <div>Host: <code>${host}</code></div>
      </div>

      <div class="row">
        <label>Token <input id="token" size="60" placeholder="Bearer token" /></label>
        <button id="saveToken">Save</button>
        <button id="ping">Ping</button>
      </div>

      <div class="row">
        <label>Kind
          <select id="kind">
            <option value="query">query</option>
            <option value="command">command</option>
          </select>
        </label>
        <label>Id <input id="opId" size="40" placeholder="system.ping" /></label>
        <button id="send">Send</button>
        <button id="loadSyncState" class="muted">sync.state</button>
        <button id="watchSync" class="muted">Watch /events</button>
      </div>

      <div>
        <div class="muted">Payload (JSON)</div>
        <textarea id="payload">null</textarea>
      </div>

      <div>
        <div class="muted">Response</div>
        <pre id="output"></pre>
      </div>
    </div>

    <script>
      const tokenInput = document.getElementById('token');
      const kindInput = document.getElementById('kind');
      const idInput = document.getElementById('opId');
      const payloadInput = document.getElementById('payload');
      const output = document.getElementById('output');
      let eventSource = null;

      const params = new URLSearchParams(location.search);
      const tokenFromQuery = params.get('token');
      const tokenFromStorage = localStorage.getItem('opencove:worker:token');
      tokenInput.value = tokenFromQuery || tokenFromStorage || '';

      function setOutput(value) {
        output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      }

      async function invoke(kind, id, payload) {
        const token = tokenInput.value.trim();
        if (!token) {
          throw new Error('Missing token');
        }

        const res = await fetch('/invoke', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ kind, id, payload }),
        });

        const text = await res.text();
        const data = text.trim().length ? JSON.parse(text) : null;
        return { httpStatus: res.status, data };
      }

      document.getElementById('saveToken').addEventListener('click', () => {
        localStorage.setItem('opencove:worker:token', tokenInput.value.trim());
        setOutput({ ok: true, saved: true });
      });

      document.getElementById('ping').addEventListener('click', async () => {
        try {
          idInput.value = 'system.ping';
          kindInput.value = 'query';
          payloadInput.value = 'null';
          const result = await invoke('query', 'system.ping', null);
          setOutput(result);
        } catch (err) {
          setOutput({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      });

      document.getElementById('send').addEventListener('click', async () => {
        try {
          const kind = kindInput.value;
          const id = idInput.value.trim();
          const rawPayload = payloadInput.value.trim();
          const payload = rawPayload.length ? JSON.parse(rawPayload) : null;
          const result = await invoke(kind, id, payload);
          setOutput(result);
        } catch (err) {
          setOutput({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      });

      document.getElementById('loadSyncState').addEventListener('click', async () => {
        try {
          idInput.value = 'sync.state';
          kindInput.value = 'query';
          payloadInput.value = 'null';
          const result = await invoke('query', 'sync.state', null);
          setOutput(result);
        } catch (err) {
          setOutput({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      });

      document.getElementById('watchSync').addEventListener('click', () => {
        try {
          const token = tokenInput.value.trim();
          if (!token) {
            throw new Error('Missing token');
          }

          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }

          const url = '/events?token=' + encodeURIComponent(token);
          eventSource = new EventSource(url);
          setOutput({ ok: true, watching: true, url });

          eventSource.addEventListener('opencove.sync', (event) => {
            try {
              const payload = JSON.parse(event.data);
              setOutput({ ok: true, event: payload });
            } catch {
              setOutput({ ok: true, event: event.data });
            }
          });

          eventSource.addEventListener('error', () => {
            setOutput({ ok: false, error: 'Event stream error (disconnected?)' });
          });
        } catch (err) {
          setOutput({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      });
    </script>
  </body>
</html>`
}
