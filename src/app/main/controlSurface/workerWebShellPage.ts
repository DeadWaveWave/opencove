import { renderWorkerWebShellClientScript } from './workerWebShellClientScript'

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
  const script = renderWorkerWebShellClientScript()

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
      hr { border: 0; border-top: 1px solid rgba(127,127,127,.35); margin: 16px 0; }
      .terminal-output { height: 280px; overflow: auto; white-space: pre-wrap; }
      .badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(127,127,127,.35); }
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
        <label>Token <input id="token" size="60" placeholder="Bearer token (optional if using web session cookie)" /></label>
        <button id="saveToken">Save</button>
        <a class="muted" href="/auth/logout">Logout</a>
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

      <hr />

      <div class="row">
        <h2 style="margin:0">PTY Streaming</h2>
        <span class="badge muted">WS <code>/pty</code> (<code>opencove-pty.v1</code>)</span>
      </div>

      <div class="row">
        <button id="listSessions">session.list</button>
        <label>Space ID <input id="spaceId" size="38" placeholder="spaceId for spawnTerminal" /></label>
        <button id="spawnTerminal">session.spawnTerminal</button>
      </div>

      <div class="row">
        <label>Session ID <input id="ptySessionId" size="42" placeholder="sessionId to attach" /></label>
        <label>Cols <input id="ptyCols" size="5" value="80" /></label>
        <label>Rows <input id="ptyRows" size="5" value="24" /></label>
        <button id="ptyConnect">Connect</button>
        <button id="ptyDisconnect" class="muted">Disconnect</button>
        <button id="ptyTakeControl">Take Control</button>
        <button id="ptyReleaseControl" class="muted">Release</button>
        <button id="ptySnapshot" class="muted">Snapshot</button>
      </div>

      <div class="row muted">
        <div>Role: <code id="ptyRole">-</code></div>
        <div>Controller: <code id="ptyController">-</code></div>
        <div>Seq: <code id="ptySeq">-</code></div>
      </div>

      <div>
        <div class="muted">Terminal output</div>
        <pre id="ptyOutput" class="terminal-output"></pre>
      </div>

      <div class="row">
        <label>Input <input id="ptyInput" size="50" placeholder="Type and press Enter" /></label>
        <label class="muted"><input id="ptyAppendNewline" type="checkbox" checked /> append \\n</label>
        <button id="ptySend">Send</button>
      </div>
    </div>

    <script>
${script}
    </script>
  </body>
</html>`
}
