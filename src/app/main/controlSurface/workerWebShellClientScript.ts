export function renderWorkerWebShellClientScript(): string {
  return `
const tokenInput = document.getElementById('token')
const kindInput = document.getElementById('kind')
const idInput = document.getElementById('opId')
const payloadInput = document.getElementById('payload')
const output = document.getElementById('output')
let eventSource = null

const params = new URLSearchParams(location.search)
const tokenFromQuery = params.get('token')
const tokenFromStorage = localStorage.getItem('opencove:worker:token')
tokenInput.value = tokenFromQuery || tokenFromStorage || ''

function setOutput(value) {
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

async function invoke(kind, id, payload) {
  const token = tokenInput.value.trim()
  const headers = { 'content-type': 'application/json' }
  if (token) {
    headers.authorization = 'Bearer ' + token
  }

  const res = await fetch('/invoke', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({ kind, id, payload }),
  })

  const text = await res.text()
  const data = text.trim().length ? JSON.parse(text) : null
  return { httpStatus: res.status, data }
}

document.getElementById('saveToken').addEventListener('click', () => {
  localStorage.setItem('opencove:worker:token', tokenInput.value.trim())
  setOutput({ ok: true, saved: true })
})

document.getElementById('ping').addEventListener('click', async () => {
  try {
    idInput.value = 'system.ping'
    kindInput.value = 'query'
    payloadInput.value = 'null'
    const result = await invoke('query', 'system.ping', null)
    setOutput(result)
  } catch (err) {
    setOutput({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

document.getElementById('send').addEventListener('click', async () => {
  try {
    const kind = kindInput.value
    const id = idInput.value.trim()
    const rawPayload = payloadInput.value.trim()
    const payload = rawPayload.length ? JSON.parse(rawPayload) : null
    const result = await invoke(kind, id, payload)
    setOutput(result)
  } catch (err) {
    setOutput({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

document.getElementById('loadSyncState').addEventListener('click', async () => {
  try {
    idInput.value = 'sync.state'
    kindInput.value = 'query'
    payloadInput.value = 'null'
    const result = await invoke('query', 'sync.state', null)
    setOutput(result)
  } catch (err) {
    setOutput({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

document.getElementById('watchSync').addEventListener('click', () => {
  try {
    const token = tokenInput.value.trim()

    if (eventSource) {
      eventSource.close()
      eventSource = null
    }

    const url = token ? '/events?token=' + encodeURIComponent(token) : '/events'
    eventSource = new EventSource(url)
    setOutput({ ok: true, watching: true, url })

    eventSource.addEventListener('opencove.sync', event => {
      try {
        const payload = JSON.parse(event.data)
        setOutput({ ok: true, event: payload })
      } catch {
        setOutput({ ok: true, event: event.data })
      }
    })

    eventSource.addEventListener('error', () => {
      setOutput({ ok: false, error: 'Event stream error (disconnected?)' })
    })
  } catch (err) {
    setOutput({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

// --- PTY streaming ---

const ptyOutput = document.getElementById('ptyOutput')
const ptyRole = document.getElementById('ptyRole')
const ptyController = document.getElementById('ptyController')
const ptySeq = document.getElementById('ptySeq')
const ptySessionIdInput = document.getElementById('ptySessionId')
const ptyColsInput = document.getElementById('ptyCols')
const ptyRowsInput = document.getElementById('ptyRows')
const ptyInput = document.getElementById('ptyInput')
const ptyAppendNewline = document.getElementById('ptyAppendNewline')

const PTY_PROTOCOL_VERSION = 1
const PTY_SUBPROTOCOL = 'opencove-pty.v1'
let ptySocket = null
let ptyActiveSessionId = null
let ptyLastSeq = null

function ptyKeyForSeq(sessionId) {
  return 'opencove:worker:pty:lastSeq:' + sessionId
}

function setPtyStatus(status) {
  ptyRole.textContent = status.role || '-'
  ptyController.textContent = status.controller || '-'
  ptySeq.textContent = typeof status.seq === 'number' ? String(status.seq) : '-'
}

function appendPty(text) {
  ptyOutput.textContent += text
  ptyOutput.scrollTop = ptyOutput.scrollHeight
}

function setPtyOutput(text) {
  ptyOutput.textContent = text || ''
  ptyOutput.scrollTop = ptyOutput.scrollHeight
}

function resolvePtyWsUrl() {
  const token = tokenInput.value.trim()
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = scheme + '//' + location.host + '/pty'
  return token ? base + '?token=' + encodeURIComponent(token) : base
}

function ptySendJson(payload) {
  if (!ptySocket || ptySocket.readyState !== WebSocket.OPEN) {
    throw new Error('PTY socket is not connected')
  }

  ptySocket.send(JSON.stringify(payload))
}

async function ptyFetchSnapshot(sessionId) {
  const result = await invoke('query', 'session.snapshot', { sessionId })
  if (result.httpStatus !== 200 || !result.data || !result.data.ok) {
    throw new Error('session.snapshot failed')
  }
  return result.data.value
}

function ptyDisconnect() {
  if (!ptySocket) {
    return
  }

  try {
    ptySocket.close()
  } catch {
    // ignore
  }

  ptySocket = null
  ptyActiveSessionId = null
  ptyLastSeq = null
  setPtyStatus({ role: '-', controller: '-', seq: null })
}

function ptyConnect(sessionId) {
  ptyDisconnect()
  setPtyStatus({ role: '-', controller: '-', seq: null })

  const shouldHydrateFromSnapshot = (ptyOutput.textContent || '').trim().length === 0
  const url = resolvePtyWsUrl()
  const ws = new WebSocket(url, PTY_SUBPROTOCOL)
  ptySocket = ws
  ptyActiveSessionId = sessionId

  ws.addEventListener('open', () => {
    try {
      ptySendJson({
        type: 'hello',
        protocolVersion: PTY_PROTOCOL_VERSION,
        client: { kind: 'web', version: 'worker-web-shell' },
      })
    } catch (err) {
      appendPty('\\n[hello error] ' + String(err && err.message ? err.message : err) + '\\n')
    }
  })

  ws.addEventListener('message', async event => {
    let message = null
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return
    }

    if (message.type === 'hello_ack') {
      const connectedMarker = '[connected]\\n'
      appendPty(connectedMarker)
      let attachAfterSeq = null

      if (shouldHydrateFromSnapshot) {
        try {
          const snapshot = await ptyFetchSnapshot(sessionId)
          if (snapshot && typeof snapshot.scrollback === 'string') {
            setPtyOutput(connectedMarker + snapshot.scrollback)
          }

          if (snapshot && typeof snapshot.toSeq === 'number') {
            attachAfterSeq = snapshot.toSeq
            ptyLastSeq = snapshot.toSeq
            localStorage.setItem(ptyKeyForSeq(sessionId), String(ptyLastSeq))
            ptySeq.textContent = String(ptyLastSeq)
          }
        } catch (err) {
          appendPty('[snapshot error] ' + String(err && err.message ? err.message : err) + '\\n')
        }
      } else {
        const raw = localStorage.getItem(ptyKeyForSeq(sessionId))
        const afterSeq = raw ? Number(raw) : null
        attachAfterSeq = Number.isFinite(afterSeq) ? afterSeq : null
      }

      try {
        const attachPayload = {
          type: 'attach',
          sessionId,
          role: 'controller',
          ...(typeof attachAfterSeq === 'number' ? { afterSeq: attachAfterSeq } : {}),
        }
        ptySendJson(attachPayload)

        const cols = Number(ptyColsInput.value)
        const rows = Number(ptyRowsInput.value)
        if (Number.isFinite(cols) && Number.isFinite(rows)) {
          ptySendJson({ type: 'resize', sessionId, cols, rows })
        }
      } catch (err) {
        appendPty('[attach error] ' + String(err && err.message ? err.message : err) + '\\n')
      }
      return
    }

    if (message.type === 'attached') {
      const controllerId =
        message.controller && message.controller.clientId ? String(message.controller.clientId) : '-'
      setPtyStatus({ role: message.role, controller: controllerId, seq: message.seq })
      ptyLastSeq = typeof message.seq === 'number' ? message.seq : ptyLastSeq
      if (typeof ptyLastSeq === 'number') {
        localStorage.setItem(ptyKeyForSeq(sessionId), String(ptyLastSeq))
      }
      return
    }

    if (message.type === 'control_changed') {
      const controllerId =
        message.controller && message.controller.clientId ? String(message.controller.clientId) : '-'
      setPtyStatus({ role: message.role, controller: controllerId, seq: ptyLastSeq })
      return
    }

    if (message.type === 'data') {
      if (typeof message.data === 'string') {
        appendPty(message.data)
      }
      if (typeof message.seq === 'number') {
        ptyLastSeq = message.seq
        localStorage.setItem(ptyKeyForSeq(sessionId), String(ptyLastSeq))
        ptySeq.textContent = String(ptyLastSeq)
      }
      return
    }

    if (message.type === 'exit') {
      appendPty('\\n[exit] code=' + String(message.exitCode) + '\\n')
      return
    }

    if (message.type === 'overflow') {
      appendPty('\\n[overflow] replay window exceeded; fetching snapshot...\\n')
      try {
        const snapshot = await ptyFetchSnapshot(sessionId)
        if (snapshot && typeof snapshot.scrollback === 'string') {
          setPtyOutput(snapshot.scrollback)
        }
        if (snapshot && typeof snapshot.toSeq === 'number') {
          ptyLastSeq = snapshot.toSeq
          localStorage.setItem(ptyKeyForSeq(sessionId), String(ptyLastSeq))
          ptySeq.textContent = String(ptyLastSeq)
        }
      } catch (err) {
        appendPty('[snapshot error] ' + String(err && err.message ? err.message : err) + '\\n')
      }
      return
    }

    if (message.type === 'error') {
      appendPty(
        '\\n[error] ' +
          String(message.code || 'unknown') +
          ': ' +
          String(message.message || '') +
          '\\n',
      )
    }
  })

  ws.addEventListener('close', event => {
    appendPty('\\n[disconnected] code=' + String(event.code) + '\\n')
    ptyDisconnect()
  })

  ws.addEventListener('error', () => {
    appendPty('\\n[ws error]\\n')
  })
}

document.getElementById('listSessions').addEventListener('click', async () => {
  try {
    const result = await invoke('query', 'session.list', null)
    setOutput(result)
  } catch (err) {
    setOutput({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

document.getElementById('spawnTerminal').addEventListener('click', async () => {
  try {
    const spaceId = document.getElementById('spaceId').value.trim()
    if (!spaceId) {
      throw new Error('Missing spaceId')
    }

    const cols = Number(ptyColsInput.value)
    const rows = Number(ptyRowsInput.value)
    const result = await invoke('command', 'session.spawnTerminal', {
      spaceId,
      ...(Number.isFinite(cols) ? { cols } : {}),
      ...(Number.isFinite(rows) ? { rows } : {}),
    })
    setOutput(result)

    const sessionId =
      result && result.data && result.data.ok && result.data.value ? result.data.value.sessionId : null
    if (sessionId) {
      ptySessionIdInput.value = sessionId
      setPtyOutput('')
      ptyConnect(sessionId)
    }
  } catch (err) {
    setOutput({ ok: false, error: String(err && err.message ? err.message : err) })
  }
})

document.getElementById('ptyConnect').addEventListener('click', () => {
  const sessionId = ptySessionIdInput.value.trim()
  if (!sessionId) {
    appendPty('\\n[error] Missing sessionId\\n')
    return
  }
  ptyConnect(sessionId)
})

document.getElementById('ptyDisconnect').addEventListener('click', () => {
  ptyDisconnect()
})

document.getElementById('ptyTakeControl').addEventListener('click', () => {
  const sessionId = (ptyActiveSessionId || ptySessionIdInput.value).trim()
  if (!sessionId) {
    return
  }
  try {
    ptySendJson({ type: 'request_control', sessionId })
  } catch (err) {
    appendPty('[control error] ' + String(err && err.message ? err.message : err) + '\\n')
  }
})

document.getElementById('ptyReleaseControl').addEventListener('click', () => {
  const sessionId = (ptyActiveSessionId || ptySessionIdInput.value).trim()
  if (!sessionId) {
    return
  }
  try {
    ptySendJson({ type: 'release_control', sessionId })
  } catch (err) {
    appendPty('[control error] ' + String(err && err.message ? err.message : err) + '\\n')
  }
})

document.getElementById('ptySnapshot').addEventListener('click', async () => {
  const sessionId = (ptyActiveSessionId || ptySessionIdInput.value).trim()
  if (!sessionId) {
    return
  }

  try {
    const snapshot = await ptyFetchSnapshot(sessionId)
    setPtyOutput(snapshot.scrollback || '')
    if (typeof snapshot.toSeq === 'number') {
      ptyLastSeq = snapshot.toSeq
      localStorage.setItem(ptyKeyForSeq(sessionId), String(ptyLastSeq))
      ptySeq.textContent = String(ptyLastSeq)
    }
  } catch (err) {
    appendPty('[snapshot error] ' + String(err && err.message ? err.message : err) + '\\n')
  }
})

function ptySendInput() {
  const sessionId = (ptyActiveSessionId || ptySessionIdInput.value).trim()
  if (!sessionId) {
    return
  }

  const raw = ptyInput.value
  if (!raw || raw.trim().length === 0) {
    return
  }

  const data = ptyAppendNewline.checked ? raw + '\\n' : raw
  try {
    ptySendJson({ type: 'write', sessionId, data })
    ptyInput.value = ''
  } catch (err) {
    appendPty('[send error] ' + String(err && err.message ? err.message : err) + '\\n')
  }
}

document.getElementById('ptySend').addEventListener('click', () => {
  ptySendInput()
})

ptyInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault()
    ptySendInput()
  }
})
`.trim()
}
