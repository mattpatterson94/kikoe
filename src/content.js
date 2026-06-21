// Runs in the ISOLATED content-script world at document_end.
// Stamps the extension base URL on the root element, then injects
// injected.js into the page's own JavaScript context so it can access wkof.

(function () {
  var base = chrome.runtime.getURL('');

  // Pass the base URL to injected.js via a temporary data attribute.
  document.documentElement.setAttribute('data-wkvi-ext', base);

  var s = document.createElement('script');
  s.src = base + 'injected.js';
  document.documentElement.appendChild(s);
  s.remove();
}());
