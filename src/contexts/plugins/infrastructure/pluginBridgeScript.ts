/** Served by the plugin asset gateway before the author's own scripts. */
export const PLUGIN_BRIDGE_SCRIPT = String.raw`
(() => {
  const channel = 'opencove-plugin-v1';
  const pending = new Map();
  const themeListeners = new Set();
  let context;
  let parentOrigin;
  let resolveReady;
  let sequence = 0;
  const resourceRoot = new URL('./', document.currentScript.src);
  let presence;
  let reconnectTimer;
  let disconnectedAt;
  let retired = false;
  let restoreRequested = false;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  function retire() {
    retired = true;
    clearTimeout(reconnectTimer);
    for (const media of document.querySelectorAll('audio, video')) media.pause();
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error('OpenCove plugin view closed.'));
    }
    pending.clear();
  }
  function connectPresence() {
    if (retired) return;
    const url = new URL('__lifecycle', resourceRoot);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      presence = new WebSocket(url);
    } catch {
      retire();
      return;
    }
    presence.addEventListener('open', () => { disconnectedAt = undefined; });
    presence.addEventListener('close', event => {
      if (retired) return;
      disconnectedAt ??= Date.now();
      if (event.code === 4001 || Date.now() - disconnectedAt >= 180000) {
        retire();
        return;
      }
      reconnectTimer = setTimeout(connectPresence, 1000);
    });
  }
  window.addEventListener('pagehide', () => {
    retire();
    presence?.close();
    const url = new URL('__close', resourceRoot).href;
    if (!navigator.sendBeacon(url)) {
      fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
    }
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted || !retired || restoreRequested) return;
    restoreRequested = true;
    parent.postMessage({ channel, type: 'restore' },
      parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*');
  });
  connectPresence();
  function applyTheme(value) {
    context = value;
    document.documentElement.dataset.theme = value.theme;
    document.documentElement.dataset.coveTheme = value.theme;
    for (const [name, color] of Object.entries(value.colors || {})) {
      document.documentElement.style.setProperty(name, color);
    }
    for (const listener of themeListeners) listener(value.theme, value.colors);
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || !event.data || event.data.channel !== channel) return;
    if (parentOrigin && event.origin !== parentOrigin) return;
    const message = event.data;
    if (message.type === 'init' && !context) {
      parentOrigin = event.origin;
      applyTheme(message.context);
      resolveReady(context);
    } else if (message.type === 'theme' && context) {
      applyTheme({ ...context, ...message.context });
    } else if (message.type === 'result' && pending.has(message.id)) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(task.timer);
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.value);
    }
  });
  async function request(operation, payload = {}) {
    await ready;
    if (retired) throw new Error('OpenCove plugin view closed.');
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('OpenCove plugin request timed out: ' + operation));
      }, 45000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ channel, type: 'request', id, operation, payload },
        parentOrigin === 'null' ? '*' : parentOrigin);
    });
  }
  window.opencovePlugin = Object.freeze({
    ready,
    invoke: (method, params = null) => request('invoke', { method, params }),
    storage: Object.freeze({
      get: key => request('storage.get', { key }),
      set: (key, value) => request('storage.set', { key, value }),
    }),
    setTitle: title => request('title', { title }),
    onThemeChange: listener => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
  });
  parent.postMessage({ channel, type: 'ready' }, '*');
})();
`
