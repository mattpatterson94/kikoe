// Runs in the PAGE's JS context (world: MAIN).
// Bridges WaniKani's window-level events to document so the content script
// and the bundled app (also injected into the page) can both hear them.
(function () {
  window.addEventListener('didAnswerQuestion', function (e) {
    document.dispatchEvent(new CustomEvent('kikoe:didAnswerQuestion', { detail: e.detail }));
  });
}());
