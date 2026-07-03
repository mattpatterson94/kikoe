// Background script (MV3 service worker / MV2 background page).
// Opens the extension options page when the content script asks — content
// scripts can't call runtime.openOptionsPage themselves, so the idle
// indicator's "No API token" click is forwarded here (see content.ts).
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'kikoe:openOptions') chrome.runtime.openOptionsPage();
});
