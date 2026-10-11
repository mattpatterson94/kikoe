// Stand-in for the WebExtension runtime, so the unmodified content.js (built
// by `npm run build`) can boot inside a WKWebView. PageSession.swift wraps
// this file and content.js into one user script that runs in the isolated
// "Kikoe" WKContentWorld at document end:
//
//   (function () {
//     <this file>                       // defines kikoeChrome, installs hooks
//     (function (chrome) { <content.js> })(kikoeChrome);
//   })();
//
// Like a real content script, this world shares the DOM with the page but
// not its JavaScript globals, so the site's own scripts (BunPro's included)
// can't see chrome.storage, the WaniKani API token, or the kikoeExt handler,
// which is only registered in this world. Only DOM events and the
// data-kikoe-config attribute cross over, exactly as in the browsers.
//
// - chrome.storage is backed by JSON files in the app's container via
//   kikoeExt. Changes from any page or the native settings screen come back
//   through window.__kikoeStorageChanged, so onChanged fires for all of them.
// - content.ts injects injected.js and bundle.js as <script src> tags; the
//   append is intercepted here and the native side evaluates the bundled
//   copy in the page world instead, since the sites' CSP would block a
//   custom-scheme script URL.
const KIKOE_BASE = 'kikoe-ext://ext/';
const kikoeExt = window.webkit.messageHandlers.kikoeExt;
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
      return kikoeCall({ op: 'storage.set', area, items: JSON.stringify(items) }).then(() => {});
    },
    remove(keys) {
      return kikoeCall({ op: 'storage.remove', area, keys: JSON.stringify(keys) }).then(() => {});
    },
  };
}

window.__kikoeStorageChanged = function (changes, area) {
  for (const listener of kikoeStorageListeners) {
    try { listener(changes, area); } catch (err) { console.error('[kikoe] storage listener', err); }
  }
};

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

(function interceptScriptInjection() {
  const root = document.documentElement;
  const original = root.appendChild.bind(root);
  root.appendChild = function (node) {
    const src = node && node.tagName === 'SCRIPT' ? node.getAttribute('src') : null;
    if (src && src.startsWith(KIKOE_BASE)) {
      kikoeCall({ op: 'inject', name: src.slice(KIKOE_BASE.length) })
        .catch((err) => console.error('[kikoe] resource failed', src, err));
      return node;
    }
    return original(node);
  };
}());

// Mirror Kikoe's console output into the device log.
(function forwardLogs() {
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
        try { kikoeExt.postMessage({ op: 'log', text: '[content] ' + level + ': ' + text }); } catch { /* ignore */ }
      }
    };
  }
}());
