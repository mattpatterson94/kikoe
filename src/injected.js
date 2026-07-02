// Runs in the PAGE's JavaScript context, injected by content.js.
// Provides GM_getResourceText and unsafeWindow shims, then loads app.js
// after the dictionary data is ready.

(function () {
  var base = document.documentElement.getAttribute('data-kikoe-ext');
  document.documentElement.removeAttribute('data-kikoe-ext');

  if (!base) {
    console.error('[kikoe] Extension base URL not found.');
    return;
  }

  // In the page context window === unsafeWindow.
  window.unsafeWindow = window;

  // app.js calls GM_getResourceText synchronously; it's only invoked after
  // we've populated `resources` below (app.js is injected inside .then()).
  var resources = {};
  window.GM_getResourceText = function (name) {
    return resources[name] || null;
  };

  Promise.all([
    fetch(base + 'data/jmdict.json').then(function (r) { return r.text(); }),
    fetch(base + 'data/kanjidic2.json').then(function (r) { return r.text(); }),
  ]).then(function (results) {
    resources.jmdict = results[0];
    resources.kanjidic2 = results[1];

    var s = document.createElement('script');
    s.src = base + 'vendor/app.js';
    document.documentElement.appendChild(s);
  }).catch(function (err) {
    console.error('[kikoe] Failed to load resources:', err);
  });
}());
