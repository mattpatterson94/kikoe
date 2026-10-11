// Stand-in for the WebExtension runtime, so the unmodified content.js (built
// by `npm run build`) can boot inside a WKWebView. WebView.swift wraps this
// file, the extension resources, and content.js into one page-world
// WKUserScript:
//
//   (function () {
//     <this file>                       // defines kikoeChrome, installs hooks
//     __kikoeResources['bundle.js'] = function () { <bundle.js> };
//     ...
//     (function (chrome) { <content.js> })(kikoeChrome);
//   })();
//
// Differences from the real extension worth remembering:
// - Everything runs in the page world: there is no isolated content-script
//   world, so the WaniKani API token is visible to page JS. Fine for a spike;
//   a real app would move content.ts's work into a WKContentWorld or native.
// - chrome.storage is backed by UserDefaults via the kikoeExt handler.
// - Extension URLs (kikoe-ext://ext/...) are served by intercepting
//   <script src> injection and fetch(), not by a URL scheme handler, because
//   the sites' CSP would block a custom scheme.
const KIKOE_BASE = 'kikoe-ext://ext/';
const kikoeExt = window.webkit.messageHandlers.kikoeExt;
const __kikoeResources = {};
const kikoeStorageListeners = [];

function kikoeCall(message) {
  return kikoeExt.postMessage(message).then((reply) => (reply ? JSON.parse(reply) : null));
}

function kikoeStorageArea(area) {
  return {
    get(keys) {
      return kikoeCall({ op: 'storage.get', area, keys: JSON.stringify(keys === undefined ? null : keys) })
        .then((r) => r || {});
    },
    set(items) {
      return kikoeCall({ op: 'storage.set', area, items: JSON.stringify(items) }).then((changes) => {
        if (!changes || !Object.keys(changes).length) return;
        for (const listener of kikoeStorageListeners) {
          try { listener(changes, area); } catch (err) { console.error('[kikoe] storage listener', err); }
        }
      });
    },
    remove(keys) {
      return kikoeCall({ op: 'storage.remove', area, keys: JSON.stringify(keys) }).then(() => {});
    },
  };
}

const kikoeChrome = {
  storage: {
    sync: kikoeStorageArea('sync'),
    local: kikoeStorageArea('local'),
    onChanged: { addListener: (fn) => kikoeStorageListeners.push(fn) },
  },
  runtime: {
    lastError: undefined,
    getURL: (path) => KIKOE_BASE + path,
    sendMessage(message, callback) {
      kikoeCall({ op: 'runtime.sendMessage', message: JSON.stringify(message) });
      if (typeof callback === 'function') setTimeout(callback, 0);
    },
  },
};

// content.ts injects injected.js and bundle.js as <script src> tags on the
// root element; run the embedded copies instead.
(function interceptScriptInjection() {
  const root = document.documentElement;
  const original = root.appendChild.bind(root);
  root.appendChild = function (node) {
    const src = node && node.tagName === 'SCRIPT' ? node.getAttribute('src') : null;
    if (src && src.startsWith(KIKOE_BASE)) {
      const run = __kikoeResources[src.slice(KIKOE_BASE.length)];
      if (run) {
        try { run(); } catch (err) { console.error('[kikoe] resource failed', src, err); }
      } else {
        console.error('[kikoe] missing resource', src);
      }
      return node;
    }
    return original(node);
  };
}());

// dict.ts fetches the dictionary JSON from the extension base URL.
(function interceptFetch() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    if (url && url.startsWith(KIKOE_BASE)) {
      return kikoeExt.postMessage({ op: 'resource', path: url.slice(KIKOE_BASE.length) })
        .then((body) => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    }
    return originalFetch(input, init);
  };
}());

// The native host owns the microphone permission; don't let a WebKit
// 'prompt'/'denied' for getUserMedia (which we never call) mark it denied.
(function interceptMicPermission() {
  const perms = navigator.permissions;
  if (!perms || !perms.query) return;
  const originalQuery = perms.query.bind(perms);
  perms.query = function (descriptor) {
    if (descriptor && descriptor.name === 'microphone') {
      return Promise.resolve({ state: 'granted', onchange: null });
    }
    return originalQuery(descriptor);
  };
}());

// Mirror Kikoe's console output into the Xcode / simctl log for the spike.
(function forwardLogs() {
  const log = window.webkit.messageHandlers.kikoeLog;
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = function (...args) {
      original(...args);
      const text = args.map((a) => {
        if (a instanceof Error) return a.stack || String(a);
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
      }).join(' ');
      if (level === 'error' || text.includes('[kikoe]')) {
        try { log.postMessage(level + ': ' + text); } catch { /* ignore */ }
      }
    };
  }
}());
