const defaults = {
  apiToken: '',
  turbo: true,
  speed_show_info: true,
  ippatsu_meaning: false,
  ippatsu_reading: false,
  transcript: true,
  transcript_theme: 'system',
  transcript_position: 'top',
  show_help_button: true,
  keep_screen_awake: true,
  strict_kanji_readings: false,
  debug: false,
  customCorrections: [],
};

const apiTokenPageUrl = 'https://www.wanikani.com/settings/personal_access_tokens';
const apiTokenDiscoveryRequestedKey = 'kikoe_api_token_discovery_requested';
const apiTokenDiscoveryStatusKey = 'kikoe_api_token_discovery_status';

// Keys read/written via a same-id form element. customCorrections is edited
// through the dynamic row list below instead.
const fields = Object.keys(defaults).filter((k) => k !== 'customCorrections');

function get(id) { return document.getElementById(id); }

function setTokenStatus(message, state = '') {
  const status = get('tokenStatus');
  status.textContent = message;
  status.className = `status${state ? ` ${state}` : ''}`;
}

async function findApiToken() {
  const button = get('findApiToken');
  button.disabled = true;
  setTokenStatus('Opening WaniKani token settings...');
  try {
    await chrome.storage.local.set({
      [apiTokenDiscoveryRequestedKey]: true,
      [apiTokenDiscoveryStatusKey]: 'pending',
    });
    chrome.runtime.sendMessage({ type: 'kikoe:openApiTokenPage' }, () => {
      if (chrome.runtime.lastError) window.open(apiTokenPageUrl, '_blank');
    });
    setTokenStatus('Sign in to WaniKani if needed. Kikoe will fill this in when the token page loads.');
  } catch {
    window.open(apiTokenPageUrl, '_blank');
    setTokenStatus('WaniKani token settings opened. Copy a read-only token and paste it here.', 'error');
  } finally {
    button.disabled = false;
  }
}

function handleTokenDiscoveryStatus(status) {
  if (status === 'found') {
    setTokenStatus('Token found and saved.', 'ok');
  } else if (status === 'not_found') {
    setTokenStatus('No token found on the page. Create or copy a read-only token, then paste it here.', 'error');
  }
}

// ── custom corrections editor ─────────────────────────────────────────────────

function refreshCorrectionsChrome() {
  const hasRows = !!get('corrections').children.length;
  get('correctionHeader').hidden = !hasRows;
  get('correctionsEmpty').hidden = hasRows;
}

function correctionRow({ heard = '', intended = '' } = {}) {
  const row = document.createElement('div');
  row.className = 'correction-row';

  const heardInput = document.createElement('input');
  heardInput.type = 'text';
  heardInput.className = 'heard';
  heardInput.placeholder = 'what was heard';
  heardInput.value = heard;

  const intendedInput = document.createElement('input');
  intendedInput.type = 'text';
  intendedInput.className = 'intended';
  intendedInput.placeholder = 'what you meant';
  intendedInput.value = intended;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '✕';
  remove.title = 'Remove correction';
  remove.setAttribute('aria-label', 'Remove correction');
  remove.addEventListener('click', () => {
    row.remove();
    refreshCorrectionsChrome();
  });

  row.append(heardInput, intendedInput, remove);
  return row;
}

function renderCorrections(pairs) {
  get('corrections').replaceChildren(...(pairs || []).map(correctionRow));
  refreshCorrectionsChrome();
}

// Rows with either side blank are dropped on save rather than stored.
function readCorrections() {
  return [...get('corrections').querySelectorAll('.correction-row')]
    .map((row) => ({
      heard: row.querySelector('.heard').value.trim(),
      intended: row.querySelector('.intended').value.trim(),
    }))
    .filter((p) => p.heard && p.intended);
}

get('addCorrection').addEventListener('click', () => {
  const row = correctionRow();
  get('corrections').appendChild(row);
  refreshCorrectionsChrome();
  row.querySelector('.heard').focus();
});

get('findApiToken').addEventListener('click', findApiToken);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.apiToken?.newValue) {
    get('apiToken').value = changes.apiToken.newValue;
    setTokenStatus('Token found and saved.', 'ok');
  }
  if (area === 'local' && changes[apiTokenDiscoveryStatusKey]?.newValue) {
    handleTokenDiscoveryStatus(changes[apiTokenDiscoveryStatusKey].newValue);
  }
});

// ── site access ───────────────────────────────────────────────────────────────
//
// Safari defaults an extension's website access to "Ask" even for required
// (non-optional) host_permissions, and never prompts on its own: content
// scripts simply don't run until the user finds Kikoe's toolbar menu or
// Safari's Extensions settings. Since content.js can't run, it can't explain
// itself either — so this card, on a page that runs regardless of site
// permission, is where the gap gets surfaced. Chrome and Firefox grant the
// same origins at install, so the card stays hidden there.

// Taken from the manifest rather than repeated here: options.js is copied
// verbatim by build.sh (no bundler, so it can't import), and a hand-kept copy
// would drift from the three manifests. `injected` is what content_scripts
// needs to run at all — the case where Kikoe looks broken — while `declared`
// also covers api.wanikani.com, worth folding into the same prompt but never
// the reason the UI is missing.
function siteAccessOrigins() {
  const manifest = chrome.runtime.getManifest?.() || {};
  const injected = (manifest.content_scripts || []).flatMap((cs) => cs.matches || []);
  const declared = manifest.host_permissions || [];
  return { injected, all: [...new Set([...declared, ...injected])] };
}

// "https://www.wanikani.com/*" → "www.wanikani.com", for status messages.
function originHost(origin) {
  return origin.replace(/^[a-z]+:\/\//i, '').replace(/\/\*?$/, '');
}

// Checked one origin at a time on purpose: a single contains() call over the
// whole set is all-or-nothing, so a user who allowed WaniKani but not BunPro
// would be told Kikoe can't run on the site where it works fine.
async function missingSiteAccess() {
  const { injected } = siteAccessOrigins();
  const granted = await Promise.all(
    injected.map((origin) => chrome.permissions.contains({ origins: [origin] })),
  );
  return injected.filter((_, i) => !granted[i]);
}

function setSiteAccessStatus(message, state = '') {
  const status = get('siteAccessStatus');
  status.textContent = message;
  status.className = `status${state ? ` ${state}` : ''}`;
}

async function refreshSiteAccess() {
  const card = get('siteAccessCard');
  if (!chrome.permissions?.contains) {
    card.hidden = true;
    return;
  }
  try {
    card.hidden = !(await missingSiteAccess()).length;
  } catch (err) {
    // Can't tell either way. Showing the card beats silently doing nothing on
    // the one browser it exists for: its manual steps are correct advice for
    // anyone whose extension isn't running, and the button is guarded.
    console.error('[kikoe] could not read site access:', err);
    card.hidden = false;
  }
}

function checkSiteAccess() {
  refreshSiteAccess().catch((err) => console.error('[kikoe] site access check failed:', err));
}

// Re-reads the real grant instead of trusting request()'s boolean, which
// can't express the partial grant the native prompt allows (some sites
// permitted, others not). The card deliberately stays up on success so the
// reload instruction is readable — nothing is missing by the next refresh,
// so it goes away then.
async function reportSiteAccess() {
  let missing;
  try {
    missing = await missingSiteAccess();
  } catch {
    setSiteAccessStatus('Could not confirm site access — use the steps below.', 'error');
    return;
  }
  if (!missing.length) {
    setSiteAccessStatus('Access granted — reload WaniKani or BunPro to start using Kikoe.', 'ok');
    return;
  }
  setSiteAccessStatus(`Still no access for ${missing.map(originHost).join(', ')} — use the steps below.`, 'error');
}

async function grantSiteAccess() {
  const button = get('grantSiteAccess');
  button.disabled = true;
  try {
    await chrome.permissions.request({ origins: siteAccessOrigins().all });
  } catch (err) {
    // Chromium rejects request() outright for origins that aren't in
    // optional_host_permissions, and Safari may decline to prompt at all.
    // Either way the manual steps under the button still apply, and
    // reportSiteAccess below says so.
    console.error('[kikoe] site access request failed:', err);
  }
  button.disabled = false;
  await reportSiteAccess();
}

get('grantSiteAccess').addEventListener('click', grantSiteAccess);

// The card sends users to Safari's own settings, so re-check when they come
// back — otherwise they return to the same card and copy and reasonably
// conclude it didn't work. onAdded covers a grant made through the prompt;
// visibilitychange covers one made outside the browser entirely.
chrome.permissions?.onAdded?.addListener(checkSiteAccess);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkSiteAccess();
});

// ── form load/save ────────────────────────────────────────────────────────────

function readForm() {
  const values = {};
  for (const key of fields) {
    const el = get(key);
    if (!el) continue;
    if (el.type === 'checkbox') values[key] = el.checked;
    else if (el.type === 'number') values[key] = parseFloat(el.value);
    else values[key] = el.value;
  }
  values.customCorrections = readCorrections();
  return values;
}

function populateForm(settings) {
  for (const key of fields) {
    const el = get(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key] ?? defaults[key];
  }
  renderCorrections(settings.customCorrections);
}

async function load() {
  const [stored, discovery] = await Promise.all([
    chrome.storage.sync.get(Object.keys(defaults)),
    chrome.storage.local.get(apiTokenDiscoveryStatusKey),
  ]);
  populateForm({ ...defaults, ...stored });
  if (stored.apiToken) {
    handleTokenDiscoveryStatus(discovery[apiTokenDiscoveryStatusKey]);
  }
}

get('save').addEventListener('click', async () => {
  const values = readForm();
  await chrome.storage.sync.set(values);
  // Reflect what was actually stored (e.g. half-filled rows are dropped).
  renderCorrections(values.customCorrections);
  const save = get('save');
  save.textContent = 'Saved.';
  save.disabled = true;
  setTimeout(() => { save.textContent = 'Save settings'; save.disabled = false; }, 2000);
});

load();
checkSiteAccess();
