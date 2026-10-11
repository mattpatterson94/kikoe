(function () {
  try {
    const h = window.webkit.messageHandlers.kikoeUI;
    const post = h.postMessage.bind(h);
    // Drop the page's own indicator/transcript updates so the staged ones stay.
    h.postMessage = (m) => { if (m && (m.type === 'indicator' || m.type === 'transcript' || m.type === 'clearTranscript' || m.type === 'helpHint')) return; return post(m); };
    window.__shot = (text, detail) => {
      post({ type: 'indicator', state: 'listening', label: 'Listening', tone: 'normal' });
      if (text) post({ type: 'transcript', text, detail: detail || null, error: false, position: 'bottom', correction: null });
    };
    window.__shot(window.__shotText, window.__shotDetail);
    console.log('[kikoe] SHOTEVAL ok', h.postMessage === post);
  } catch (e) { console.error('[kikoe] SHOTEVAL', e); }
})();
