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
  debug: false,
  customCorrections: [],
};

const apiTokenPageUrl = 'https://www.wanikani.com/settings/personal_access_tokens';
const apiTokenDiscoveryRequestedKey = 'kikoe_api_token_discovery_requested';
const apiTokenDiscoveryStatusKey = 'kikoe_api_token_discovery_status';

// Chrome/Firefox grant these at install since they're required (not optional)
// host_permissions, so `contains` is always true there and this card never
// shows. Safari instead defaults every extension's site access to "Ask",
// even for required permissions, and only reveals that through its toolbar
// icon or Settings > Extensions — easy to miss entirely. Calling `request`
// here surfaces Safari's native allow dialog directly from a page the user
// already opened deliberately.
const SITE_ACCESS_ORIGINS = [
  'https://www.wanikani.com/*',
  'https://api.wanikani.com/*',
  'https://bunpro.jp/*',
  'https://www.bunpro.jp/*',
];

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

// ── site access (Safari's per-site permission gate) ─────────────────────────────

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
  const granted = await chrome.permissions.contains({ origins: SITE_ACCESS_ORIGINS });
  card.hidden = granted;
}

async function grantSiteAccess() {
  const button = get('grantSiteAccess');
  button.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: SITE_ACCESS_ORIGINS });
    if (granted) {
      setSiteAccessStatus('Access granted — reload WaniKani or BunPro to start using Kikoe.', 'ok');
      get('siteAccessCard').hidden = true;
    } else {
      setSiteAccessStatus("Access wasn't granted, so Kikoe can't run on WaniKani or BunPro yet.", 'error');
    }
  } catch {
    setSiteAccessStatus('Could not request access automatically — open Safari Settings > Extensions > Kikoe and set website access to Allow.', 'error');
  } finally {
    button.disabled = false;
  }
}

get('grantSiteAccess').addEventListener('click', grantSiteAccess);

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
refreshSiteAccess();
