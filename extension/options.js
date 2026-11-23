const defaults = {
  apiToken: '',
  site_wanikani: true,
  site_bunpro: true,
  turbo: true,
  speed_show_info: true,
  ippatsu_meaning: false,
  ippatsu_reading: false,
  transcript: true,
  transcript_theme: 'system',
  transcript_position: 'top',
  show_help_button: true,
  keep_screen_awake: true,
  strict_kanji_readings: true,
  recognizer: 'cloud',
  contextual_hints: true,
  noise_reduction: false,
  debug: false,
  customCorrections: [],
};

const apiTokenPageUrl = 'https://www.wanikani.com/settings/personal_access_tokens';
const apiTokenDiscoveryRequestedKey = 'kikoe_api_token_discovery_requested';
const apiTokenDiscoveryStatusKey = 'kikoe_api_token_discovery_status';

// Settings each app keeps its own copy of, stored as `<site>:<key>` with the
// plain key as the fallback. Mirrors SITE_SETTING_KEYS in src/settings.ts and
// SiteSettings.swift (options.js is copied verbatim, so it can't import).
const sites = ['wanikani', 'bunpro'];
const siteSettingKeys = [
  'turbo', 'speed_show_info', 'ippatsu_meaning', 'ippatsu_reading',
  'transcript', 'transcript_theme', 'transcript_position', 'show_help_button',
  'strict_kanji_readings',
];
const siteKey = (site, key) => `${site}:${key}`;

// Keys read/written via a same-id form element. customCorrections is edited
// through the dynamic row list below instead, and the per-app keys through
// each app card's copy of the template.
const fields = Object.keys(defaults)
  .filter((k) => k !== 'customCorrections' && !siteSettingKeys.includes(k));

function get(id) { return document.getElementById(id); }

// Each app panel gets the per-app controls, with ids like `bunpro:turbo`.
for (const site of sites) {
  const content = get('appSettingsTemplate').content.cloneNode(true);
  for (const el of content.querySelectorAll('[data-key]')) el.id = siteKey(site, el.dataset.key);
  for (const label of content.querySelectorAll('label[data-for]')) label.htmlFor = siteKey(site, label.dataset.for);
  get(`app_${site}`).appendChild(content);
}

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
    scheduleSave(0);
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
    if (lastSaved) lastSaved.apiToken = changes.apiToken.newValue;
    setTokenStatus('Token found and saved.', 'ok');
    refreshTokenBanner();
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

// ── sections ──────────────────────────────────────────────────────────────────
//
// One panel at a time, picked from the sidebar and kept in the URL hash so a
// reload (or the token banner's link) lands on the same one.

const panelNames = ['general', 'wanikani', 'bunpro', 'advanced'];

function navLink(name) {
  return document.querySelector(`nav.sections a[data-panel="${name}"]`);
}

function showPanel(name) {
  if (!panelNames.includes(name) || navLink(name).hidden) name = 'general';
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.dataset.panel !== name;
  for (const link of document.querySelectorAll('nav.sections a')) {
    if (link.dataset.panel === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function showPanelFromHash() {
  showPanel(location.hash.slice(1));
}

window.addEventListener('hashchange', showPanelFromHash);

// ── apps ──────────────────────────────────────────────────────────────────────
//
// Same rule as the iOS app's Settings → Apps: at least one stays on, so the
// last checked box is locked. An app's own page only shows while it's on.

function refreshApps() {
  const toggles = [...document.querySelectorAll('.site-toggle')];
  const on = toggles.filter((t) => t.checked);
  for (const t of toggles) t.disabled = t.checked && on.length === 1;
  for (const site of sites) navLink(site).hidden = !get(`site_${site}`).checked;
  refreshTokenBanner();
  showPanelFromHash();
}

// WaniKani does nothing without a token, so say so wherever you are.
function refreshTokenBanner() {
  const missing = get('site_wanikani').checked && !get('apiToken').value.trim();
  get('tokenBanner').hidden = !missing || location.hash === '#wanikani';
  get('tokenDot').hidden = !missing;
}

window.addEventListener('hashchange', refreshTokenBanner);

for (const toggle of document.querySelectorAll('.site-toggle')) {
  toggle.addEventListener('change', refreshApps);
}

// ── recognizer (Web Speech extras) ────────────────────────────────────────────
//
// The counterparts of the iOS app's Advanced recognizer settings, shown only
// where the browser's SpeechRecognition has the feature (recognition.ts
// feature-detects the same way at runtime). Safari and Firefox hide them.

const onDeviceLangs = ['ja-JP', 'en-US'];
const SpeechRecognitionCtor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const speechProto = SpeechRecognitionCtor?.prototype;
const supportsOnDevice = !!speechProto && 'processLocally' in speechProto
  && typeof SpeechRecognitionCtor.available === 'function';
const supportsHints = supportsOnDevice && typeof globalThis.SpeechRecognitionPhrase === 'function';
// start(audioTrack) has no feature test of its own; it shipped in Chrome
// before processLocally did, so a browser with on-device support has it.
const supportsNoiseReduction = supportsOnDevice && !!navigator.mediaDevices?.getUserMedia;

function langName(lang) {
  return lang.startsWith('ja') ? 'Japanese' : 'English';
}

async function refreshOnDeviceModels() {
  const status = get('onDeviceModelsStatus');
  const button = get('installOnDeviceModels');
  try {
    const states = await Promise.all(onDeviceLangs.map((lang) =>
      SpeechRecognitionCtor.available({ langs: [lang], processLocally: true })));
    const describe = { available: 'ready', downloadable: 'not downloaded', downloading: 'downloading…', unavailable: 'not offered' };
    status.textContent = onDeviceLangs.map((lang, i) => `${langName(lang)}: ${describe[states[i]] || states[i]}`).join(' · ');
    button.hidden = !states.some((s) => s === 'downloadable');
  } catch (err) {
    console.error('[kikoe] could not check on-device models:', err);
    status.textContent = "Couldn't check on-device models.";
    button.hidden = true;
  }
}

async function installOnDeviceModels() {
  const button = get('installOnDeviceModels');
  button.disabled = true;
  get('onDeviceModelsStatus').textContent = 'Downloading…';
  try {
    await SpeechRecognitionCtor.install({ langs: onDeviceLangs, processLocally: true });
  } catch (err) {
    console.error('[kikoe] on-device model install failed:', err);
  }
  button.disabled = false;
  await refreshOnDeviceModels();
}

function refreshRecognizer() {
  const onDevice = get('recognizer').value === 'on_device';
  get('onDeviceModelsField').hidden = !onDevice;
  get('contextual_hints').disabled = !onDevice;
  if (onDevice) refreshOnDeviceModels();
}

get('recognizerGroup').hidden = !supportsOnDevice;
get('recognizerField').hidden = !supportsOnDevice;
get('contextualHintsField').hidden = !supportsHints;
get('noiseReductionField').hidden = !supportsNoiseReduction;
get('recognizer').addEventListener('change', refreshRecognizer);
get('installOnDeviceModels').addEventListener('click', installOnDeviceModels);

{
  const manifest = chrome.runtime.getManifest?.();
  if (manifest?.version) get('version').textContent = `Kikoe ${manifest.version}`;
}

// ── form load/save ────────────────────────────────────────────────────────────
//
// Changes save as they're made: toggles and selects at once, typed text once
// typing pauses. Only the keys that differ from what was last stored are
// written, which keeps well clear of chrome.storage.sync's write quota.

function readField(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return parseFloat(el.value);
  return el.value;
}

function writeField(el, value, fallback) {
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value ?? fallback;
}

// Each app's own copy of every per-app setting is written. The plain keys are
// left as they were, as the fallback older versions still read.
function readForm() {
  const values = {};
  for (const key of fields) {
    const el = get(key);
    if (el) values[key] = readField(el);
  }
  for (const site of sites) {
    for (const key of siteSettingKeys) {
      const el = get(siteKey(site, key));
      if (el) values[siteKey(site, key)] = readField(el);
    }
  }
  values.customCorrections = readCorrections();
  return values;
}

function populateForm(settings) {
  for (const key of fields) {
    const el = get(key);
    if (el) writeField(el, settings[key], defaults[key]);
  }
  for (const site of sites) {
    for (const key of siteSettingKeys) {
      const el = get(siteKey(site, key));
      if (el) writeField(el, settings[siteKey(site, key)] ?? settings[key], defaults[key]);
    }
  }
  renderCorrections(settings.customCorrections);
  refreshApps();
  if (supportsOnDevice) refreshRecognizer();
}

// Mirrors migrateSettings in content.ts, which can't be imported here. Runs
// before the form is populated so a pre-migration value is never shown or
// re-saved.
const settingsVersionKey = 'settings_version';
const settingsVersion = 1;

async function migrateSettings() {
  const stored = await chrome.storage.sync.get([settingsVersionKey, 'strict_kanji_readings']);
  const version = stored[settingsVersionKey] ?? 0;
  if (version >= settingsVersion) return;
  const patch = { [settingsVersionKey]: settingsVersion };
  // v1: strict kanji readings became the default; flip the old stored false.
  if (version < 1 && stored.strict_kanji_readings === false) patch.strict_kanji_readings = true;
  await chrome.storage.sync.set(patch);
}

async function load() {
  await migrateSettings();
  const [stored, discovery] = await Promise.all([
    chrome.storage.sync.get([
      ...Object.keys(defaults),
      ...sites.flatMap((site) => siteSettingKeys.map((key) => siteKey(site, key))),
    ]),
    chrome.storage.local.get(apiTokenDiscoveryStatusKey),
  ]);
  populateForm({ ...defaults, ...stored });
  lastSaved = readForm();
  if (stored.apiToken) {
    handleTokenDiscoveryStatus(discovery[apiTokenDiscoveryStatusKey]);
  }
}

let lastSaved = null;
let saveTimer = null;
let savedTimer = null;

function showSaveState(message) {
  get('saveState').textContent = message;
  clearTimeout(savedTimer);
  if (message) savedTimer = setTimeout(() => { get('saveState').textContent = ''; }, 2500);
}

function unsavedChanges() {
  const changed = {};
  for (const [key, value] of Object.entries(readForm())) {
    if (JSON.stringify(value) !== JSON.stringify(lastSaved[key])) changed[key] = value;
  }
  return changed;
}

// The write in flight, if any. Saves run one at a time: an edit made while a
// write is pending compares against the value that write is about to store,
// so the form is checked again after every write rather than skipped. (Change
// a setting and back mid-write, and the second save would otherwise see
// nothing new and leave the intermediate value stored.)
let saving = null;

function save() {
  if (!lastSaved) return Promise.resolve(); // not loaded yet
  if (saving) return saving;
  saving = (async () => {
    try {
      for (;;) {
        const changed = unsavedChanges();
        if (!Object.keys(changed).length) break;
        await chrome.storage.sync.set(changed);
        Object.assign(lastSaved, changed);
        showSaveState('Saved');
      }
    } catch (err) {
      console.error('[kikoe] could not save settings:', err);
      showSaveState("Couldn't save. Try again in a moment.");
    } finally {
      saving = null;
    }
  })();
  return saving;
}

function scheduleSave(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { save(); }, delay);
}

const main = document.querySelector('main');
main.addEventListener('change', () => scheduleSave(0));
main.addEventListener('input', (event) => {
  if (event.target.matches('input[type=text], input[type=password]')) scheduleSave(600);
  if (event.target.id === 'apiToken') refreshTokenBanner();
});
// Don't lose a pending text save when the tab closes.
window.addEventListener('pagehide', () => { if (saveTimer) save(); });

load();
checkSiteAccess();
