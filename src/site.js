// Hostname → site key used to pick the per-site adapter module.
// Shared by the content script (isolated world) and the page bundle.
export function detectSite(hostname) {
  if (!hostname) return null;
  if (hostname === 'wanikani.com' || hostname.endsWith('.wanikani.com')) return 'wanikani';
  if (hostname === 'bunpro.jp' || hostname.endsWith('.bunpro.jp')) return 'bunpro';
  return null;
}
