// Page-world support for injected.js and bundle.js, installed at document
// start in the main frame. Nothing here can reach storage or the API token:
// those live behind the isolated world's kikoeExt handler (see
// ContentWorldShim.js). The page world only gets read access to the files
// bundled with the app, the speech and overlay handlers, and logging.
(function () {
  const KIKOE_BASE = 'kikoe-ext://ext/';
  const handlers = window.webkit.messageHandlers;

  // dict.ts fetches the dictionary JSON from the extension base URL.
  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    if (url && url.startsWith(KIKOE_BASE)) {
      return handlers.kikoeResource.postMessage({ path: url.slice(KIKOE_BASE.length) })
        .then((body) => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    }
    return originalFetch(input, init);
  };

  // The app owns the microphone permission; don't let WebKit's 'prompt' or
  // 'denied' for getUserMedia (which Kikoe never calls here) mark it denied.
  const perms = navigator.permissions;
  if (perms && perms.query) {
    const originalQuery = perms.query.bind(perms);
    perms.query = function (descriptor) {
      if (descriptor && descriptor.name === 'microphone') {
        return Promise.resolve({ state: 'granted', onchange: null });
      }
      return originalQuery(descriptor);
    };
  }

  // Mirror Kikoe's console output into the device log.
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
        try { handlers.kikoeLog.postMessage(level + ': ' + text); } catch { /* ignore */ }
      }
    };
  }
}());
