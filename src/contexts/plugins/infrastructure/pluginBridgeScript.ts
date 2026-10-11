import { PLUGIN_HOST_METHODS } from '../domain/pluginHostApi'

/** Served by the plugin asset gateway before the author's own scripts. */
export const PLUGIN_BRIDGE_SCRIPT = String.raw`
(() => {
  const channel = 'opencove-plugin-v1';
  const pending = new Map();
  const themeListeners = new Set();
  const themeProperties = new Set();
  const themeFonts = new Set();
  let themeGeneration = 0;
  let themeFontSignature;
  let context;
  let parentOrigin;
  let resolveReady;
  let resolveRetired;
  const retirement = new Promise(resolve => { resolveRetired = resolve; });
  let sequence = 0;
  const resourceRoot = new URL('./', document.currentScript.src);
  let presence;
  let reconnectTimer;
  let disconnectedAt;
  let retired = false;
  let restoreRequested = false;
  let commandHandler;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  function announceCommandReadiness() {
    if (!retired && presence?.readyState === WebSocket.OPEN) {
      try {
        presence.send(JSON.stringify({ type: 'ready', protocol: 2, ready: Boolean(commandHandler && context) }));
      } catch { presence.close(); }
    }
  }
  function encodeCommand(value, limit) {
    const encoded = JSON.stringify(value ?? null, (_key, entry) => {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' ||
          typeof entry === 'bigint' || (typeof entry === 'number' && !Number.isFinite(entry))) {
        throw new Error('Plugin window commands require JSON values.');
      }
      return entry;
    });
    if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > limit) {
      throw new Error('Plugin window command exceeds its size limit.');
    }
    return encoded;
  }
  function bindCommands(connection) {
    const active = new Set();
    function reply(message) {
      if (retired || presence !== connection || connection.readyState !== WebSocket.OPEN) return;
      const encoded = encodeCommand(message, 2 * 1024 * 1024);
      connection.send(encoded);
    }
    connection.addEventListener('message', event => {
      if (retired || presence !== connection) return;
      let message;
      try {
        if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > 1024 * 1024) {
          throw new Error('Invalid plugin command payload.');
        }
        message = JSON.parse(event.data);
        if (!message || message.type !== 'command' || message.protocol !== 2 ||
            typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 128 ||
            typeof message.commandId !== 'string' || !message.commandId || message.commandId.length > 80 ||
            !Object.hasOwn(message, 'params') || active.has(message.requestId) || active.size >= 128) {
          throw new Error('Invalid plugin command.');
        }
        encodeCommand(message.params, 1024 * 1024);
      } catch {
        connection.close(1008, 'Invalid plugin command');
        return;
      }
      const handler = commandHandler;
      active.add(message.requestId);
      Promise.resolve().then(() => {
        if (retired || presence !== connection || connection.readyState !== WebSocket.OPEN) {
          throw new Error('OpenCove plugin view closed.');
        }
        if (!handler || !context) throw new Error('Plugin window is not ready for commands.');
        return handler(message.commandId, message.params, message.context ?? null);
      }).then(value => {
        reply({ type: 'result', protocol: 2, requestId: message.requestId, ok: true, value: value ?? null });
      }).catch(error => {
        try {
          reply({ type: 'result', protocol: 2, requestId: message.requestId, ok: false,
            error: String(error?.message || error).slice(0, 4000) });
        } catch { /* Connection failure is observed by the host; never replay an action. */ }
      }).finally(() => active.delete(message.requestId));
    });
  }
  function retire() {
    retired = true;
    resolveRetired();
    clearTimeout(reconnectTimer);
    for (const media of document.querySelectorAll('audio, video')) media.pause();
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error('OpenCove plugin view closed.'));
    }
    pending.clear();
    themeGeneration++;
    for (const font of themeFonts) document.fonts.delete(font);
    themeFonts.clear();
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
    bindCommands(presence);
    presence.addEventListener('open', () => {
      disconnectedAt = undefined;
      announceCommandReadiness();
    });
    presence.addEventListener('close', event => {
      if (retired) return;
      disconnectedAt ??= Date.now();
      if ([4001, 1008, 1009].includes(event.code) || Date.now() - disconnectedAt >= 180000) {
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
    if (retired) return;
    context = value;
    const root = document.documentElement;
    root.dataset.theme = value.theme;
    root.dataset.coveTheme = value.theme;
    root.dataset.coveThemeId = value.themeId || value.theme;
    root.dataset.coveThemeBase = value.baseThemeId || value.theme;
    const tokens = value.tokens || value.colors || {};
    for (const name of themeProperties) {
      if (!Object.hasOwn(tokens, name)) root.style.removeProperty(name);
    }
    themeProperties.clear();
    for (const [name, token] of Object.entries(tokens)) {
      root.style.setProperty(name, token);
      themeProperties.add(name);
    }
    const fontSignature = JSON.stringify(value.fonts || []);
    if (fontSignature !== themeFontSignature) {
      themeFontSignature = fontSignature;
      const generation = ++themeGeneration;
      for (const font of themeFonts) document.fonts.delete(font);
      themeFonts.clear();
      if (typeof FontFace === 'function') {
        for (const entry of value.fonts || []) {
          try {
            const font = new FontFace(entry.family, entry.source, entry.descriptors || {});
            themeFonts.add(font);
            document.fonts.add(font);
            font.load().then(() => {
              if (retired || generation !== themeGeneration) document.fonts.delete(font);
            }, () => { document.fonts.delete(font); themeFonts.delete(font); });
          } catch { /* Failed custom font falls back to the author's font stack. */ }
        }
      }
    }
    for (const listener of themeListeners) {
      try { listener(value.theme, value.colors, value); } catch { /* One view callback cannot interrupt delivery. */ }
    }
  }
  window.addEventListener('message', event => {
    if (retired || event.source !== parent || !event.data || event.data.channel !== channel) return;
    if (parentOrigin && event.origin !== parentOrigin) return;
    const message = event.data;
    if (message.type === 'init' && !context) {
      parentOrigin = event.origin;
      applyTheme(message.context);
      resolveReady(context);
      announceCommandReadiness();
    } else if (message.type === 'theme' && context) {
      applyTheme({ ...context, ...message.context });
    } else if (message.type === 'result' && pending.has(message.id)) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(task.timer);
      if (message.error) {
        const error = new Error(message.error);
        if (message.errorDescriptor) {
          error.code = message.errorDescriptor.code;
          error.params = message.errorDescriptor.params;
        }
        task.reject(error);
      }
      else task.resolve(message.value);
    }
  });
  async function request(operation, payload = {}) {
    if (retired) throw new Error('OpenCove plugin view closed.');
    await Promise.race([ready, retirement]);
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
    host: Object.freeze(Object.fromEntries(
      Object.entries(${JSON.stringify(PLUGIN_HOST_METHODS)}).map(([group, methods]) => [
        group, Object.freeze(Object.fromEntries(methods.map(method => [
          method, (input = {}) => request('host.request', { operation: group + '.' + method, payload: input }),
        ]))),
      ]),
    )),
    invoke: (method, params = null) => request('invoke', { method, params }),
    preferences: Object.freeze({
      get: () => request('preferences.get'),
      set: (key, value) => request('preferences.set', { key, value }),
    }),
    storage: Object.freeze({
      get: key => request('storage.get', { key }),
      set: (key, value) => request('storage.set', { key, value }),
    }),
    setTitle: title => request('title', { title }),
    onThemeChange: listener => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    onCommand: handler => {
      if (typeof handler !== 'function') throw new Error('Plugin command handler must be a function.');
      if (retired) throw new Error('OpenCove plugin view closed.');
      commandHandler = handler;
      announceCommandReadiness();
      return () => {
        if (commandHandler !== handler) return;
        commandHandler = undefined;
        announceCommandReadiness();
      };
    },
  });
  parent.postMessage({ channel, type: 'ready' }, '*');
})();
`
