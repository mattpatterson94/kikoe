// Background script (MV3 service worker / MV2 background page).
// Opens privileged pages when the content script asks — content scripts can't
// call runtime.openOptionsPage or create tabs themselves, so clicks from the
// page-world UI are forwarded here (see content.ts).
const API_TOKEN_PAGE_URL = 'https://www.wanikani.com/settings/personal_access_tokens';

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'kikoe:openOptions') chrome.runtime.openOptionsPage();
  if (message?.type === 'kikoe:openApiTokenPage') chrome.tabs.create({ url: API_TOKEN_PAGE_URL });
});
